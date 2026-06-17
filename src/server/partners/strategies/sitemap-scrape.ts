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
  type SyncProgressEvent,
} from '../sync-utils';

export async function syncSiteViaSitemapScrape(
  site: PartnerSite,
  onProgress?: (e: SyncProgressEvent) => void,
): Promise<SyncResult> {
  const start = Date.now();
  const sitemapUrl = site.seedUrls[0];
  if (!sitemapUrl) throw new Error('sitemap_scrape: seedUrls[0] must be the sitemap XML URL');

  const sitemapResp = await fetch(sitemapUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PropMatchBot/1.0)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!sitemapResp.ok) throw new Error(`Sitemap fetch failed: ${sitemapResp.status}`);
  const xml = await sitemapResp.text();

  const allSitemapUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1]!.trim())
    .filter((u) => {
      try { return new URL(u).pathname.split('/').filter(Boolean).length >= 2; }
      catch { return false; }
    });

  const currentSet = new Set(allSitemapUrls.map(canonicalListingUrl));

  const knownSources = await prisma.propertySource_.findMany({
    where: { partnerSiteId: site.id },
    select: { url: true, propertyId: true },
  });
  const knownUrlSet = new Set([...knownSources.map((s) => s.url), ...site.knownUrls]);
  const newUrls = [...currentSet].filter((u) => !knownUrlSet.has(u));

  let removed = 0;
  const removedSources = knownSources.filter((s) => !currentSet.has(s.url));
  if (removedSources.length > 0) {
    const propertyIds = [...new Set(removedSources.map((s) => s.propertyId))];
    await prisma.property.updateMany({ where: { id: { in: propertyIds } }, data: { active: false } });
    removed = propertyIds.length;
  }

  const firecrawl = getFirecrawl();
  const SCRAPE_CONCURRENCY = 3;
  let added = 0;
  let errors = 0;

  for (let i = 0; i < newUrls.length; i += SCRAPE_CONCURRENCY) {
    const chunk = newUrls.slice(i, i + SCRAPE_CONCURRENCY);
    onProgress?.({ phase: 'scrape', fetched: i + chunk.length, added, total: newUrls.length });

    const settled = await Promise.allSettled(
      chunk.map(async (url) => {
        const result = await firecrawl.scrape(url, { formats: ['markdown'], onlyMainContent: false, timeout: 45000 });
        const markdown = (result as Record<string, unknown>).markdown as string | undefined ?? '';
        const raw = await extractFromMarkdown(markdown, url);
        return { url, raw };
      }),
    );

    for (const outcome of settled) {
      if (outcome.status === 'rejected') { errors++; continue; }
      const { url, raw } = outcome.value;
      if (!raw?.price || !raw?.title) { errors++; continue; }
      try {
        await upsertListing(raw, url, site);
        added++;
      } catch (err) {
        logger.warn('sitemap_scrape_upsert_error', { url, error: String(err) });
        errors++;
      }
    }
  }

  const actualListingCount = await prisma.propertySource_.count({ where: { partnerSiteId: site.id } });
  await prisma.partnerSite.update({
    where: { id: site.id },
    data: {
      syncStatus: 'done',
      listingCount: actualListingCount,
      knownUrls: [...currentSet],
      lastSuccessAt: new Date(),
      lastScrapedAt: new Date(),
      consecutiveFailures: 0,
    },
  });

  const durationMs = Date.now() - start;
  logger.info('sitemap_scrape_complete', { domain: site.domain, sitemapUrl, total: currentSet.size, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}
