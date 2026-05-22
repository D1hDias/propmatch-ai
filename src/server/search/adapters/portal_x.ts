import 'server-only';
import { logger } from '@/server/lib/logger';
import { isSource2Enabled } from '@/server/lib/flags';
import { scrapeCustomUrl } from './custom-url';
import type { HealthStatus, NormalizedListing, SearchCriteria, SourceAdapter } from '../types';

// ---------------------------------------------------------------------------
// Portal X adapter (Source 2) — powered by Firecrawl self-hosted.
//
// PORTAL_X_SEARCH_URL: the search-results URL for portal_x, with placeholders
// that get replaced by criteria at runtime. If not set, adapter returns empty.
//
// Gated by ENABLE_SOURCE_2 (kill-switch). Disable without a code deploy by
// setting ENABLE_SOURCE_2=false in the systemd EnvironmentFile.
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

function buildPortalXUrl(criteria: SearchCriteria): string | null {
  const base = process.env.PORTAL_X_SEARCH_URL;
  if (!base) return null;

  // Replace simple placeholders if the operator configured a template URL.
  // e.g. PORTAL_X_SEARCH_URL=https://portal.com/busca?cidade={city}&tipo={purpose}
  return base
    .replace('{city}', encodeURIComponent(criteria.city))
    .replace('{purpose}', criteria.purpose === 'buy' ? 'venda' : 'aluguel')
    .replace('{bedrooms}', String(criteria.bedroomsMin ?? ''))
    .replace('{priceMax}', String(criteria.priceMax ?? ''));
}

export const portalXAdapter: SourceAdapter = {
  name: 'portal_x',

  async search(criteria: SearchCriteria): Promise<NormalizedListing[]> {
    if (!isSource2Enabled()) {
      logger.debug('portal_x: ENABLE_SOURCE_2 is off — skipping');
      return [];
    }

    const url = buildPortalXUrl(criteria);
    if (!url) {
      logger.warn('portal_x: PORTAL_X_SEARCH_URL not configured — returning empty');
      return [];
    }

    logger.info('portal_x search', { url, city: criteria.city });

    try {
      const { listings, error } = await scrapeCustomUrl(url, criteria);
      recordResult(!error);
      if (error) logger.warn('portal_x scrape partial error', { error });
      logger.info('portal_x returned', { count: listings.length });
      return listings;
    } catch (err) {
      recordResult(false);
      logger.error('portal_x search failed', { error: err, city: criteria.city });
      return [];
    }
  },

  async healthCheck(): Promise<HealthStatus> {
    const rate = successRate();
    return {
      source: 'portal_x',
      healthy: rate >= 0.8,
      successRate: rate,
      lastCheckedAt: new Date().toISOString(),
      message: rate < 0.8 ? 'Success rate below 80% — Firecrawl or portal may be degraded' : undefined,
    };
  },
};
