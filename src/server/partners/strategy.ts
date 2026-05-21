import 'server-only';
import { logger } from '@/server/lib/logger';
import { scrapeSite, type SiteScraperStrategy } from '@/server/search/site-scraper';
import { prisma } from '@/server/db/client';
import type { PartnerSite } from '@prisma/client';
import type { NormalizedListing, SearchCriteria } from '@/server/search/types';

// ---------------------------------------------------------------------------
// Partner site scraping dispatcher.
//
// Each partner site stored in the DB has a discoveryStrategy field that maps
// to a scraping approach in site-scraper.ts:
//
//   firecrawl_json   — one Firecrawl scrape on the search-results URL with
//                      JSON schema extraction (best for structured sites)
//
//   firecrawl_links  — get listing links from the search page, then batch-
//                      scrape individual listing pages (for unstructured sites)
//
// Legacy strategies (map_then_scrape, direct_scrape, crawl, interact) are
// treated as firecrawl_json to avoid breaking existing DB records.
// ---------------------------------------------------------------------------

const MAX_CONSECUTIVE_FAILURES = 5;

function resolveStrategy(raw: string): SiteScraperStrategy {
  if (raw === 'firecrawl_links') return 'firecrawl_links';
  return 'firecrawl_json'; // default, also covers legacy strategy names
}

export async function scrapePartnerSite(
  site: PartnerSite,
  criteria: SearchCriteria,
): Promise<NormalizedListing[]> {
  // Circuit-breaker: skip partners that have repeatedly failed
  if (site.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    logger.warn('partner_scrape_circuit_open', {
      domain: site.domain,
      consecutiveFailures: site.consecutiveFailures,
    });
    return [];
  }

  const strategy = resolveStrategy(site.discoveryStrategy);
  const start = Date.now();

  logger.info('partner_scrape_start', { domain: site.domain, strategy });

  try {
    const listings = await scrapeSite(
      {
        domain: site.domain,
        baseUrl: site.baseUrl,
        strategy,
        seedUrls: site.seedUrls,
        maxListings: 100,
        searchConfig: site.searchConfig as Record<string, unknown> | null,
      },
      criteria,
    );

    // Tag listings with the partner domain
    const tagged = listings.map((l) => ({
      ...l,
      source: 'portal_x' as const,
      externalId: l.externalId || `${site.domain}::${l.url}`,
    }));

    // Non-critical: reset failure counter
    prisma.partnerSite
      .update({
        where: { id: site.id },
        data: { lastScrapedAt: new Date(), lastSuccessAt: new Date(), consecutiveFailures: 0 },
      })
      .catch(() => {});

    logger.info('partner_scrape_complete', {
      domain: site.domain,
      strategy,
      count: tagged.length,
      durationMs: Date.now() - start,
    });

    return tagged;
  } catch (err) {
    logger.warn('partner_scrape_failed', { domain: site.domain, error: String(err) });

    prisma.partnerSite
      .update({
        where: { id: site.id },
        data: { lastErrorAt: new Date(), consecutiveFailures: { increment: 1 } },
      })
      .catch(() => {});

    return [];
  }
}
