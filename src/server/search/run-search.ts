import 'server-only';
import { logger } from '@/server/lib/logger';
import { zapAdapter } from './adapters/zap';
import { vivarealAdapter } from './adapters/vivareal';
import { mockAdapter } from './adapters/mock';
import { portalXAdapter } from './adapters/portal_x';
import { partnerBAdapter } from './adapters/partner_b';
import { scrapeCustomUrl } from './adapters/custom-url';
import { startHealthMonitor } from './health-monitor';
import type { NormalizedListing, SearchCriteria, SourceAdapter } from './types';

const SOURCE_TIMEOUT_MS = 90_000;   // 90s per preset source — Firecrawl JSON extraction needs ~90s
const CUSTOM_URL_TIMEOUT_MS = 90_000; // 90s per custom URL (Firecrawl MAP can be slow)

// ---------------------------------------------------------------------------
// Preset adapter registry
// ---------------------------------------------------------------------------

const PRESET_ADAPTERS: Record<string, SourceAdapter> = {
  zap: zapAdapter,
  vivareal: vivarealAdapter,
};

function getPresetAdapters(selectedPortals?: string[]): SourceAdapter[] {
  if (process.env.SOURCE_MOCK === 'true') return [mockAdapter];

  // undefined = not specified → use all defaults; [] = explicitly none selected
  const wanted = selectedPortals ?? ['zap', 'vivareal'];

  const adapters: SourceAdapter[] = wanted
    .map((name) => PRESET_ADAPTERS[name])
    .filter((a): a is SourceAdapter => a !== undefined);

  // Source 2: portal_x via scraper VPS — always included when configured
  if (process.env.SCRAPER_VPS_URL && process.env.SCRAPER_VPS_INTERNAL_KEY) {
    adapters.push(portalXAdapter);
  }

  // Source 3: partner_b REST API — feature flagged OFF until LOI signed
  if (process.env.FEATURE_SOURCE_PARTNER_B === 'true') {
    adapters.push(partnerBAdapter);
  }

  return adapters;
}

let monitorsStarted = false;

function ensureMonitorsRunning(adapters: SourceAdapter[]): void {
  if (monitorsStarted) return;
  monitorsStarted = true;
  startHealthMonitor(adapters);
}

// ---------------------------------------------------------------------------
// Fan-out search
// ---------------------------------------------------------------------------

export interface SearchOptions {
  portals?: string[];    // broker-selected preset portals
  customUrls?: string[]; // broker-provided imobiliária URLs
}

export interface SearchResult {
  listings: NormalizedListing[];
  sourceErrors: Array<{ source: string; error: string }>;
  customUrlResults: Array<{ url: string; count: number; error?: string }>;
  durationMs: number;
}

export async function runSearch(
  criteria: SearchCriteria,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const { portals, customUrls = [] } = options;
  const adapters = getPresetAdapters(portals);
  ensureMonitorsRunning(adapters);

  const start = Date.now();

  logger.info('search started', {
    city: criteria.city,
    neighborhood: criteria.neighborhood,
    purpose: criteria.purpose,
    presetSources: adapters.map((a) => a.name),
    customUrlCount: customUrls.length,
  });

  // Fan-out preset adapters + custom URLs in parallel
  const [presetSettled, customSettled] = await Promise.all([
    // Preset portal adapters with individual timeouts
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
    // Custom URLs with per-URL timeout
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

  // Collect preset results
  for (let i = 0; i < presetSettled.length; i++) {
    const result = presetSettled[i]!;
    const source = adapters[i]!.name;

    if (result.status === 'fulfilled') {
      listings.push(...result.value);
      logger.info('preset source returned', { source, count: result.value.length });
    } else {
      const error = String(result.reason);
      sourceErrors.push({ source, error });
      logger.warn('preset source failed', { source, error });
    }
  }

  // Collect custom URL results
  for (const result of customSettled) {
    listings.push(...result.listings);
    customUrlResults.push({
      url: result.url,
      count: result.listings.length,
      error: result.error,
    });
  }

  const durationMs = Date.now() - start;
  logger.info('search complete', {
    total: listings.length,
    durationMs,
    sourceErrors: sourceErrors.length,
    customUrlResults,
  });

  return { listings, sourceErrors, customUrlResults, durationMs };
}
