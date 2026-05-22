import 'server-only';
import { logger } from '@/server/lib/logger';
import { isSource2Enabled } from '@/server/lib/flags';
import { scrapeWithFirecrawl, mapAndScrapeWithFirecrawl } from '../firecrawl-scraper';
import type { NormalizedListing, SearchCriteria } from '../types';

// ---------------------------------------------------------------------------
// Generic URL scraper adapter — powered by Firecrawl self-hosted.
//
// Strategy for homepage URLs (pathname === '/'):
//   Use Firecrawl MAP to discover the site's property listing/search pages,
//   then scrape those with criteria-specific JSON extraction.
//
// Strategy for already-filtered URLs (search results page):
//   Scrape the URL directly — user already applied filters.
//
// Gated by ENABLE_SOURCE_2 feature flag (kill-switch without a code deploy).
// Never throws — errors are logged and returned in the result.
// ---------------------------------------------------------------------------

function isHomepageUrl(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    return (parsed.pathname === '/' || parsed.pathname === '') &&
      parsed.searchParams.toString() === '';
  } catch {
    return false;
  }
}

export async function scrapeCustomUrl(
  targetUrl: string,
  criteria: SearchCriteria,
): Promise<{ listings: NormalizedListing[]; url: string; error?: string }> {
  if (!isSource2Enabled()) {
    logger.info('custom-url skipped — ENABLE_SOURCE_2 is off', { url: targetUrl });
    return { listings: [], url: targetUrl, error: 'Source 2 disabled' };
  }

  const hostname = (() => {
    try { return new URL(targetUrl).hostname; } catch { return targetUrl; }
  })();

  const isHomepage = isHomepageUrl(targetUrl);
  logger.info('custom-url scrape start', { hostname, isHomepage });

  try {
    let raw: NormalizedListing[] = [];

    if (isHomepage) {
      // Homepage: MAP discovers the site's search/listing pages,
      // then scrapes them with criteria-specific filtering.
      logger.info('custom-url: homepage detected — using map+scrape', { hostname });
      raw = await mapAndScrapeWithFirecrawl(targetUrl, 'zap', criteria);

      // If MAP found nothing, fall back to direct scrape of the homepage
      if (raw.length === 0) {
        logger.info('custom-url: map returned 0, falling back to direct homepage scrape', { hostname });
        raw = await scrapeWithFirecrawl(targetUrl, 'zap', criteria);
      }
    } else {
      // Already a filtered/search URL — scrape it directly
      raw = await scrapeWithFirecrawl(targetUrl, 'zap', criteria);
    }

    // Re-label source as 'portal_x' to distinguish from ZAP partner results
    const relabeled = raw.map((l) => ({
      ...l,
      source: 'portal_x' as const,
      externalId: l.externalId || `custom-${hostname}-${l.url}`,
    }));
    logger.info('custom-url returned', { hostname, count: relabeled.length });
    return { listings: relabeled, url: targetUrl };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn('custom-url Firecrawl failed', { hostname, error });
    return { listings: [], url: targetUrl, error };
  }
}
