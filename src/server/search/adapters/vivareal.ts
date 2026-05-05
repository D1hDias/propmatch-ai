import 'server-only';
import { logger } from '@/server/lib/logger';
import { scrapeWithFirecrawl } from '../firecrawl-scraper';
import { scrapeWithPlaywright } from '../playwright-scraper';
import { buildVivaRealUrl } from '../url-builder';
import type { HealthStatus, NormalizedListing, SearchCriteria, SourceAdapter } from '../types';

const HEALTH_WINDOW = 100;
const results: boolean[] = [];

function recordResult(ok: boolean) {
  results.push(ok);
  if (results.length > HEALTH_WINDOW) results.shift();
}

function successRate(): number {
  if (results.length === 0) return 1;
  return results.filter(Boolean).length / results.length;
}

export const vivarealAdapter: SourceAdapter = {
  name: 'vivareal',

  async search(criteria: SearchCriteria): Promise<NormalizedListing[]> {
    const url = buildVivaRealUrl(criteria);
    logger.info('vivareal search', { url, city: criteria.city });

    try {
      const listings = await scrapeWithFirecrawl(url, 'vivareal', criteria);
      recordResult(true);
      return listings;
    } catch (firecrawlErr) {
      logger.warn('vivareal firecrawl failed — falling back to playwright', {
        error: firecrawlErr,
        url,
      });

      try {
        const listings = await scrapeWithPlaywright(url, 'vivareal', criteria);
        recordResult(listings.length > 0);
        return listings;
      } catch (playwrightErr) {
        recordResult(false);
        logger.error('vivareal playwright fallback failed', { error: playwrightErr, url });
        return [];
      }
    }
  },

  async healthCheck(): Promise<HealthStatus> {
    const rate = successRate();
    return {
      source: 'vivareal',
      healthy: rate >= 0.8,
      successRate: rate,
      lastCheckedAt: new Date().toISOString(),
      message: rate < 0.8 ? 'Success rate below 80% — may be blocked' : undefined,
    };
  },
};
