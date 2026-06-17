import 'server-only';
import { logger } from '@/server/lib/logger';
import { mockAdapter } from './adapters/mock';
import { scrapeCustomUrl } from './adapters/custom-url';
import { prisma } from '@/server/db/client';
import { scrapePartnerSite } from '@/server/partners/strategy';
import { searchCachedInventory } from '@/server/partners/cached-inventory';
import { enqueueSiteSync } from '@/server/partners/sync-queue';
import type { NormalizedListing, SearchCriteria, SourceAdapter } from './types';

const SOURCE_TIMEOUT_MS = 150_000;
const CUSTOM_URL_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Fan-out search — only partner sites and custom URLs.
// Preset portal adapters (ZAP, VivaReal) are kept in adapters/ but not wired
// into the pipeline; the product operates on manually-provided sources only.
// ---------------------------------------------------------------------------

export interface SearchOptions {
  customUrls?: string[];
  userId?: string;
  /** When provided, only these partner sites are searched (by ID). */
  partnerSiteIds?: string[];
}

export interface SearchResult {
  listings: NormalizedListing[];
  sourceErrors: Array<{ source: string; error: string }>;
  customUrlResults: Array<{ url: string; count: number; error?: string }>;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Demand-based TTL: more searches → shorter sync interval → fresher data.
// Thresholds are intentionally conservative to avoid over-scraping.
// ---------------------------------------------------------------------------
function computeSyncIntervalDays(searchCount: number): number {
  if (searchCount >= 100) return 1;   // very popular: daily
  if (searchCount >= 30)  return 2;
  if (searchCount >= 10)  return 3;
  if (searchCount >= 3)   return 5;
  return 7;                           // rarely queried: weekly
}

async function getPartnerAdapters(opts: { userId?: string; partnerSiteIds?: string[] }): Promise<SourceAdapter[]> {
  try {
    const where = opts.partnerSiteIds && opts.partnerSiteIds.length > 0
      ? { id: { in: opts.partnerSiteIds }, active: true }
      : opts.userId
        ? { userId: opts.userId, active: true }
        : { active: true };
    const sites = await prisma.partnerSite.findMany({ where });

    return sites.map((site) => {
      const syncAgeMs = site.lastScrapedAt
        ? Date.now() - site.lastScrapedAt.getTime()
        : Infinity;
      const syncFreshMs = site.syncIntervalDays * 24 * 60 * 60 * 1000;

      // A site has usable cache once it has completed at least one sync.
      // Also treat sites with indexed stock (listingCount > 0) as having a cache
      // even when syncStatus hasn't been updated to 'done' yet (e.g. data loaded
      // via external scripts or syncStatus stale after server restart).
      const hasCache =
        site.syncStatus === 'done' ||
        (site.listingCount > 0 && site.syncStatus !== 'error' && site.syncStatus !== 'running');
      const isFresh  = hasCache && syncAgeMs < syncFreshMs;

      return {
        name: site.domain as SourceAdapter['name'],
        search: async (c: SearchCriteria) => {
          // Increment searchCount and auto-adjust syncIntervalDays (non-blocking).
          const newCount = site.searchCount + 1;
          const newInterval = computeSyncIntervalDays(newCount);
          prisma.partnerSite.update({
            where: { id: site.id },
            data: {
              searchCount: { increment: 1 },
              ...(newInterval !== site.syncIntervalDays ? { syncIntervalDays: newInterval } : {}),
            },
          }).catch(() => {});

          if (hasCache) {
            // Stale-while-revalidate: always return from cache immediately.
            // If stale, trigger a background sync so the *next* search gets fresh data.
            if (!isFresh) {
              void enqueueSiteSync(site.id);
              logger.info('stale_cache_revalidating', {
                domain: site.domain,
                syncAgeDays: Math.round(syncAgeMs / 86_400_000),
              });
            }
            return searchCachedInventory(site, c);
          }

          // No cache yet (first time): scrape live and block until done,
          // then trigger a background sync so subsequent searches use cache.
          void enqueueSiteSync(site.id);
          const liveListings = await scrapePartnerSite(site, c);
          // Tag each listing with the partner site so persistResults can link
          // PropertySource_ rows correctly (avoids orphaned rows with null partnerSiteId).
          return liveListings.map((l) => ({ ...l, partnerSiteId: site.id }));
        },
        healthCheck: () => Promise.resolve({
          source: site.domain,
          healthy: true,
          successRate: 1,
          lastCheckedAt: new Date().toISOString(),
        }),
      };
    });
  } catch {
    return [];
  }
}

export async function runSearch(
  criteria: SearchCriteria,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const { customUrls = [], userId, partnerSiteIds } = options;

  // In test/dev mode, use mock adapter as the only source
  const adapters: SourceAdapter[] = process.env.SOURCE_MOCK === 'true'
    ? [mockAdapter]
    : await getPartnerAdapters({ userId, partnerSiteIds });

  const start = Date.now();

  logger.info('search_started', {
    city: criteria.city,
    neighborhood: criteria.neighborhood,
    purpose: criteria.purpose,
    partnerSites: adapters.map((a) => a.name),
    customUrlCount: customUrls.length,
  });

  const [partnerSettled, customSettled] = await Promise.all([
    Promise.allSettled(
      adapters.map((adapter) =>
        Promise.race([
          adapter.search(criteria),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Source ${adapter.name} timed out after ${SOURCE_TIMEOUT_MS}ms`)),
              SOURCE_TIMEOUT_MS,
            ),
          ),
        ]),
      ),
    ),
    Promise.all(
      customUrls.map((url) =>
        Promise.race([
          scrapeCustomUrl(url, criteria),
          new Promise<Awaited<ReturnType<typeof scrapeCustomUrl>>>((resolve) =>
            setTimeout(
              () => resolve({ url, listings: [], error: `Custom URL timed out after ${CUSTOM_URL_TIMEOUT_MS}ms` }),
              CUSTOM_URL_TIMEOUT_MS,
            ),
          ),
        ]),
      ),
    ),
  ]);

  const listings: NormalizedListing[] = [];
  const sourceErrors: Array<{ source: string; error: string }> = [];
  const customUrlResults: Array<{ url: string; count: number; error?: string }> = [];

  for (let i = 0; i < partnerSettled.length; i++) {
    const result = partnerSettled[i]!;
    const source = adapters[i]!.name;
    if (result.status === 'fulfilled') {
      listings.push(...result.value);
      logger.info('partner_source_returned', { source, count: result.value.length });
    } else {
      const error = String(result.reason);
      sourceErrors.push({ source, error });
      logger.warn('partner_source_failed', { source, error });
    }
  }

  for (const result of customSettled) {
    listings.push(...result.listings);
    customUrlResults.push({ url: result.url, count: result.listings.length, error: result.error });
  }

  const durationMs = Date.now() - start;
  logger.info('search_complete', { total: listings.length, durationMs, sourceErrors: sourceErrors.length });

  return { listings, sourceErrors, customUrlResults, durationMs };
}
