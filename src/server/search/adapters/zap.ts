import 'server-only';
import { logger } from '@/server/lib/logger';
import { scrapeWithFirecrawl } from '../firecrawl-scraper';
import { buildZapUrl } from '../url-builder';
import type { HealthStatus, NormalizedListing, SearchCriteria, SourceAdapter } from '../types';

// ---------------------------------------------------------------------------
// Health tracking (in-process, resets on restart)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ZAP Imóveis adapter
// ---------------------------------------------------------------------------

export const zapAdapter: SourceAdapter = {
  name: 'zap',

  async search(criteria: SearchCriteria): Promise<NormalizedListing[]> {
    const url = buildZapUrl(criteria);
    logger.info('zap search', { url, city: criteria.city });

    try {
      const listings = await scrapeWithFirecrawl(url, 'zap', criteria);
      recordResult(true);
      return listings;
    } catch (err) {
      recordResult(false);
      logger.error('zap firecrawl failed', { error: err, url });
      return [];
    }
  },

  async healthCheck(): Promise<HealthStatus> {
    const rate = successRate();
    return {
      source: 'zap',
      healthy: rate >= 0.8,
      successRate: rate,
      lastCheckedAt: new Date().toISOString(),
      message: rate < 0.8 ? 'Success rate below 80% — may be blocked' : undefined,
    };
  },
};
