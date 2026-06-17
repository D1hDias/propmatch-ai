import 'server-only';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';
import type { PartnerSite } from '@prisma/client';
import {
  getFirecrawl,
  canonicalListingUrl,
  extractFromMarkdown,
  upsertListing,
  type SyncResult,
} from '../sync-utils';

export async function syncSiteViaWpUrlScrape(site: PartnerSite, cpt: string): Promise<SyncResult> {
  const apiBase = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/${encodeURIComponent(cpt)}`;
  const PER_PAGE = 100;
  const allCanonicalUrls: string[] = [];
  let page = 1;

  while (true) {
    const pageUrl = `${apiBase}?per_page=${PER_PAGE}&page=${page}&_fields=id,link`;
    let items: Record<string, unknown>[] = [];
    try {
      const resp = await fetch(pageUrl, { headers: { Accept: 'application/json' } });
      if (!resp.ok) break;
      items = (await resp.json()) as Record<string, unknown>[];
      if (items.length === 0) break;
    } catch (err) {
      logger.warn('wp_url_api_fetch_failed', { domain: site.domain, cpt, page, error: String(err) });
      break;
    }
    for (const item of items) {
      const link = String(item.link ?? '');
      if (link) allCanonicalUrls.push(canonicalListingUrl(link));
    }
    logger.info('wp_url_page_done', { domain: site.domain, cpt, page, items: items.length });
    page++;
  }

  const start = Date.now();
  let added = 0;
  let removed = 0;
  let errors = 0;

  if (allCanonicalUrls.length === 0) {
    logger.warn('wp_url_sync_no_listings', { domain: site.domain, cpt });
    await prisma.partnerSite.update({
      where: { id: site.id },
      data: { syncStatus: 'done', lastScrapedAt: new Date() },
    });
    return { added: 0, removed: 0, errors: 0, durationMs: 0 };
  }

  const knownSources = await prisma.propertySource_.findMany({
    where: { partnerSiteId: site.id },
    select: { url: true, propertyId: true },
  });
  const knownUrlSet = new Set([...knownSources.map((s) => s.url), ...site.knownUrls]);
  const currentUrlSet = new Set(allCanonicalUrls);

  const newUrls = allCanonicalUrls.filter((url) => !knownUrlSet.has(url));
  const removedUrls = [...knownUrlSet].filter((url) => !currentUrlSet.has(url));

  logger.info('wp_url_sync_delta', {
    domain: site.domain, cpt, total: allCanonicalUrls.length, new: newUrls.length, removed: removedUrls.length,
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

  const firecrawl = getFirecrawl();
  const SCRAPE_CONCURRENCY = 3;
  const ANTIBOT_LIMIT = 3;
  let consecutiveAntibotErrors = 0;
  let aborted = false;

  for (let i = 0; i < newUrls.length && !aborted; i += SCRAPE_CONCURRENCY) {
    const chunk = newUrls.slice(i, i + SCRAPE_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async (url) => {
        const result = await firecrawl.scrape(url, {
          formats: ['markdown'],
          onlyMainContent: false,
          timeout: 45000,
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
            logger.warn('wp_url_antibot_abort', { domain: site.domain, skipped: newUrls.length - i });
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
        logger.warn('wp_url_upsert_error', { url, error: String(err) });
        errors++;
      }
    }

    if (i % (SCRAPE_CONCURRENCY * 10) === 0 || i + SCRAPE_CONCURRENCY >= newUrls.length) {
      logger.info('wp_url_scrape_progress', {
        domain: site.domain,
        done: Math.min(i + SCRAPE_CONCURRENCY, newUrls.length),
        total: newUrls.length,
        added,
      });
    }
  }

  await prisma.partnerSite.update({
    where: { id: site.id },
    data: {
      syncStatus: 'done',
      lastScrapedAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
      listingCount: allCanonicalUrls.length,
      knownUrls: allCanonicalUrls,
    },
  });

  const durationMs = Date.now() - start;
  logger.info('wp_url_sync_complete', { domain: site.domain, cpt, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}
