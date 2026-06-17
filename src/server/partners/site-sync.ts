import 'server-only';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';
import { autoDetectStrategy } from '@/server/partners/discovery';
import type { PartnerSite } from '@prisma/client';
import {
  getFirecrawl,
  DEFAULT_LISTING_PATTERNS,
  discoverFromSeedUrls,
  extractFromMarkdown,
  upsertListing,
  type SyncResult,
  type SyncProgressEvent,
} from './sync-utils';
import { syncSiteViaMapMarkers } from './strategies/map-markers';
import { syncSiteViaWpApi } from './strategies/wp-api';
import { syncSiteViaWpUrlScrape } from './strategies/wp-url-scrape';
import { syncSiteViaSitemapScrape } from './strategies/sitemap-scrape';
import { syncSiteViaSiteMidasApi } from './strategies/sitemidas';
import { syncSiteViaKenloApi } from './strategies/kenlo';
import { syncSiteViaKarocaBuscar } from './strategies/karioca';
import { syncSiteViaVistaHostApi } from './strategies/vistahost';
import { syncSiteViaEgoRealEstateApi } from './strategies/ego-real-estate';

export type { SyncResult, SyncProgressEvent };

// ---------------------------------------------------------------------------
// assessSite — discover listing URLs via Firecrawl MAP + seed pages
// ---------------------------------------------------------------------------

export async function assessSite(site: PartnerSite): Promise<{ listingUrls: string[] }> {
  logger.info('site_assess_start', { domain: site.domain });

  const firecrawl = getFirecrawl();
  const patterns = site.propertyUrlPatterns.length > 0
    ? site.propertyUrlPatterns
    : DEFAULT_LISTING_PATTERNS;

  let mapUrls: string[] = [];
  try {
    const mapResult = await firecrawl.map(site.baseUrl, { limit: 5000 });
    const allLinks: string[] = (mapResult.links ?? []).map((entry) =>
      typeof entry === 'string' ? entry : entry.url,
    );
    mapUrls = [...new Set(
      allLinks.filter((url) => typeof url === 'string' && patterns.some((p) => url.includes(p))),
    )];
    logger.info('site_assess_map_done', { domain: site.domain, mapUrls: mapUrls.length });
  } catch (err) {
    logger.warn('site_assess_map_failed', { domain: site.domain, error: String(err) });
  }

  const seedListings = await discoverFromSeedUrls(site, patterns);
  const seedUrlStrings = seedListings.map((s) => s.url);

  const listingUrls = [...new Set([...mapUrls, ...seedUrlStrings])];

  if (listingUrls.length === 0 && site.needsJavascript) {
    logger.warn('site_assess_needs_playwright', {
      domain: site.domain,
      hint: 'Site requires JavaScript rendering. Set needsJavascript=true and configure a Playwright worker.',
    });
  }

  logger.info('site_assess_done', {
    domain: site.domain,
    mapUrls: mapUrls.length,
    seedUrls: seedUrlStrings.length,
    total: listingUrls.length,
  });

  prisma.partnerSite
    .update({ where: { id: site.id }, data: { listingCount: listingUrls.length } })
    .catch(() => {});

  return { listingUrls };
}

// ---------------------------------------------------------------------------
// syncSite — main dispatcher: detects strategy on first run, then routes
// ---------------------------------------------------------------------------

export async function syncSite(
  site: PartnerSite,
  onProgress?: (e: SyncProgressEvent) => void,
): Promise<SyncResult> {
  if (site.consecutiveFailures >= 5) {
    logger.warn('site_sync_circuit_open', { domain: site.domain });
    return { added: 0, removed: 0, errors: 0, durationMs: 0 };
  }

  const FULL_SYNC_COOLDOWN_MS = 60 * 60 * 1000;
  if (
    site.listingCount > 0 &&
    site.lastScrapedAt !== null &&
    Date.now() - site.lastScrapedAt.getTime() < FULL_SYNC_COOLDOWN_MS
  ) {
    const syncedCount = await prisma.propertySource_.count({ where: { partnerSiteId: site.id } });
    if (syncedCount >= site.listingCount) {
      logger.info('site_sync_skip_fully_synced', {
        domain: site.domain,
        listingCount: site.listingCount,
        syncedCount,
        lastScrapedAt: site.lastScrapedAt,
      });
      return { added: 0, removed: 0, errors: 0, durationMs: 0 };
    }
  }

  const isUndetected =
    !site.discoveryStrategy ||
    (site.discoveryStrategy === 'map_then_scrape' && site.lastSuccessAt === null);
  if (isUndetected) {
    onProgress?.({ phase: 'detect', fetched: 0, added: 0 });
    try {
      const detected = await autoDetectStrategy(site);
      site = {
        ...site,
        discoveryStrategy: detected.discoveryStrategy,
        ...(detected.seedUrls ? { seedUrls: detected.seedUrls } : {}),
      };
      logger.info('sync_strategy_auto_detected', {
        domain: site.domain,
        strategy: detected.discoveryStrategy,
      });
    } catch (err) {
      logger.warn('sync_auto_detect_failed', { domain: site.domain, error: String(err) });
    }
  }

  const strategy = site.discoveryStrategy ?? 'map_then_scrape';
  const setRunning = () =>
    prisma.partnerSite.update({ where: { id: site.id }, data: { syncStatus: 'running' } });
  const setError = () =>
    prisma.partnerSite.update({
      where: { id: site.id },
      data: { syncStatus: 'error', lastErrorAt: new Date(), consecutiveFailures: { increment: 1 } },
    }).catch(() => {});

  const wpRestMatch = strategy.match(/^wp_rest_api:(.+)$/);
  if (strategy === 'wp_rest_api' || wpRestMatch) {
    const cpt = wpRestMatch ? wpRestMatch[1]! : 'estate';
    await setRunning();
    try { return await syncSiteViaWpApi(site, cpt, onProgress); }
    catch (err) { setError(); throw err; }
  }

  if (strategy === 'sitemidas_api') {
    await setRunning();
    try { return await syncSiteViaSiteMidasApi(site, onProgress); }
    catch (err) { setError(); throw err; }
  }

  if (strategy === 'kenlo_api') {
    await setRunning();
    try { return await syncSiteViaKenloApi(site, onProgress); }
    catch (err) { setError(); throw err; }
  }

  if (strategy === 'karioca_buscar') {
    await setRunning();
    try { return await syncSiteViaKarocaBuscar(site, onProgress); }
    catch (err) { setError(); throw err; }
  }

  if (strategy === 'vistahost_api') {
    await setRunning();
    try { return await syncSiteViaVistaHostApi(site, onProgress); }
    catch (err) { setError(); throw err; }
  }

  if (strategy === 'egorealestate_api') {
    await setRunning();
    try { return await syncSiteViaEgoRealEstateApi(site, onProgress); }
    catch (err) { setError(); throw err; }
  }

  if (strategy === 'map_markers') {
    await setRunning();
    try { return await syncSiteViaMapMarkers(site, onProgress); }
    catch (err) { setError(); throw err; }
  }

  if (strategy === 'sitemap_scrape') {
    await setRunning();
    try { return await syncSiteViaSitemapScrape(site, onProgress); }
    catch (err) { setError(); throw err; }
  }

  const wpUrlMatch = strategy.match(/^wp_url_scrape:(.+)$/);
  if (wpUrlMatch) {
    const cpt = wpUrlMatch[1]!;
    await setRunning();
    try { return await syncSiteViaWpUrlScrape(site, cpt); }
    catch (err) { setError(); throw err; }
  }

  // map_then_scrape fallback
  await setRunning();
  return await syncSiteViaMapThenScrape(site, onProgress);
}

// ---------------------------------------------------------------------------
// map_then_scrape — fallback when no platform is detected
// ---------------------------------------------------------------------------

async function syncSiteViaMapThenScrape(
  site: PartnerSite,
  onProgress?: (e: SyncProgressEvent) => void,
): Promise<SyncResult> {
  const start = Date.now();
  let added = 0;
  let removed = 0;
  let errors = 0;

  try {
    const patterns = site.propertyUrlPatterns.length > 0
      ? site.propertyUrlPatterns
      : DEFAULT_LISTING_PATTERNS;

    let mapUrls: string[] = [];
    try {
      const firecrawl = getFirecrawl();
      const mapResult = await firecrawl.map(site.baseUrl, { limit: 5000, includeSubdomains: true });
      const allLinks: string[] = (mapResult.links ?? []).map((e) =>
        typeof e === 'string' ? e : e.url,
      );
      mapUrls = [...new Set(
        allLinks.filter((u) => typeof u === 'string' && patterns.some((p) => u.includes(p))),
      )];
    } catch (err) {
      logger.warn('site_sync_map_failed', { domain: site.domain, error: String(err) });
    }

    const seedListings = await discoverFromSeedUrls(site, patterns);
    const seedByUrl = new Map(seedListings.map((s) => [s.url, s.rawData]));

    const allUrls = [...new Set([...mapUrls, ...seedListings.map((s) => s.url)])];

    if (allUrls.length === 0) {
      logger.warn('site_sync_no_listings', { domain: site.domain });
      await prisma.partnerSite.update({
        where: { id: site.id },
        data: { syncStatus: 'done', lastScrapedAt: new Date() },
      });
      return { added: 0, removed: 0, errors: 0, durationMs: Date.now() - start };
    }

    onProgress?.({ phase: 'map', fetched: 0, added: 0, total: allUrls.length });

    const knownSources = await prisma.propertySource_.findMany({
      where: { partnerSiteId: site.id },
      select: { url: true, propertyId: true },
    });
    const knownUrlSet = new Set(knownSources.map((s) => s.url));
    const currentUrlSet = new Set(allUrls);

    const newUrls = allUrls.filter((url) => !knownUrlSet.has(url));
    const removedUrls = [...knownUrlSet].filter((url) => !currentUrlSet.has(url));

    logger.info('site_sync_delta', {
      domain: site.domain,
      total: allUrls.length,
      new: newUrls.length,
      removed: removedUrls.length,
      fromSeed: seedListings.length,
      fromMapOnly: mapUrls.filter((u) => !seedByUrl.has(u)).length,
    });

    if (removedUrls.length > 0) {
      const removedSources = knownSources.filter((s) => removedUrls.includes(s.url));
      const propertyIds = [...new Set(removedSources.map((s) => s.propertyId))];
      await prisma.property.updateMany({
        where: { id: { in: propertyIds } },
        data: { active: false },
      });
      removed = propertyIds.length;
    }

    const mapUrlSet = new Set(mapUrls.map((u) => {
      try { return new URL(u).href.replace(/\/$/, ''); } catch { return u.replace(/\/$/, ''); }
    }));
    const seedOnlyNewUrls = newUrls.filter(
      (url) => seedByUrl.has(url) && !mapUrlSet.has(url),
    );
    for (const url of seedOnlyNewUrls) {
      const raw = seedByUrl.get(url)!;
      if (!raw.price || !raw.title) { errors++; continue; }
      try {
        await upsertListing(raw, url, site);
        added++;
      } catch (err) {
        logger.warn('site_sync_upsert_error', { url, error: String(err) });
        errors++;
      }
    }

    const mapNewUrls = newUrls.filter(
      (url) => mapUrlSet.has(url) || !seedByUrl.has(url),
    );
    const firecrawl = getFirecrawl();
    const cfg = (site.searchConfig ?? {}) as Record<string, unknown>;
    const SCRAPE_CONCURRENCY = typeof cfg.scrapeConcurrency === 'number' ? cfg.scrapeConcurrency : 3;
    const ANTIBOT_LIMIT = 3;
    let consecutiveAntibotErrors = 0;
    let aborted = false;

    for (let i = 0; i < mapNewUrls.length && !aborted; i += SCRAPE_CONCURRENCY) {
      const chunk = mapNewUrls.slice(i, i + SCRAPE_CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (url) => {
          const result = await firecrawl.scrape(url, {
            formats: ['markdown'],
            onlyMainContent: false,
            timeout: site.needsJavascript ? 90000 : 45000,
            ...(site.needsJavascript ? { waitFor: 3000 } : {}),
          });
          const markdown = (result as Record<string, unknown>).markdown as string | undefined ?? '';
          const raw = await extractFromMarkdown(markdown, url);
          return { url, raw };
        }),
      );

      for (const outcome of settled) {
        if (outcome.status === 'rejected') {
          const msg = String((outcome as PromiseRejectedResult).reason);
          if (msg.includes('antibot') || msg.includes('anti-bot') || msg.includes('SCRAPE_RETRY_LIMIT')) {
            consecutiveAntibotErrors++;
            if (consecutiveAntibotErrors >= ANTIBOT_LIMIT) {
              logger.warn('site_sync_antibot_abort', {
                domain: site.domain,
                skipped: mapNewUrls.length - i,
              });
              aborted = true;
            }
          } else {
            consecutiveAntibotErrors = 0;
          }
          errors++;
          continue;
        }
        consecutiveAntibotErrors = 0;
        const { url, raw } = outcome.value;
        if (!raw?.price || !raw?.title) { errors++; continue; }
        try {
          await upsertListing(raw, url, site);
          added++;
        } catch (err) {
          logger.warn('site_sync_upsert_error', { url, error: String(err) });
          errors++;
        }
      }

      logger.info('site_sync_scrape_progress', {
        domain: site.domain,
        done: Math.min(i + SCRAPE_CONCURRENCY, mapNewUrls.length),
        total: mapNewUrls.length,
        added,
      });
      onProgress?.({
        phase: 'scrape',
        fetched: Math.min(i + SCRAPE_CONCURRENCY, mapNewUrls.length),
        added,
        total: mapNewUrls.length,
      });
    }

    const actualListingCount = await prisma.propertySource_.count({ where: { partnerSiteId: site.id } });
    await prisma.partnerSite.update({
      where: { id: site.id },
      data: {
        syncStatus: 'done',
        lastScrapedAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        listingCount: actualListingCount,
      },
    });

    const durationMs = Date.now() - start;
    logger.info('site_sync_complete', { domain: site.domain, added, removed, errors, durationMs });
    return { added, removed, errors, durationMs };

  } catch (err) {
    logger.warn('site_sync_failed', { domain: site.domain, error: String(err) });
    prisma.partnerSite
      .update({
        where: { id: site.id },
        data: { syncStatus: 'error', lastErrorAt: new Date(), consecutiveFailures: { increment: 1 } },
      })
      .catch(() => {});
    throw err;
  }
}
