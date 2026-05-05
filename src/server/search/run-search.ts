import 'server-only';
import { logger } from '@/server/lib/logger';
import { zapAdapter } from './adapters/zap';
import { vivarealAdapter } from './adapters/vivareal';
import { mockAdapter } from './adapters/mock';
import { startHealthMonitor } from './health-monitor';
import type { NormalizedListing, SearchCriteria, SourceAdapter } from './types';

const SOURCE_TIMEOUT_MS = 30_000; // 30s per source (scraping is slower than API)

// ---------------------------------------------------------------------------
// Active adapters — determined by env flags
// ---------------------------------------------------------------------------

function getAdapters(): SourceAdapter[] {
  if (process.env.SOURCE_MOCK === 'true') return [mockAdapter];
  return [zapAdapter, vivarealAdapter];
}

let monitorsStarted = false;

function ensureMonitorsRunning(): void {
  if (monitorsStarted) return;
  monitorsStarted = true;
  startHealthMonitor(getAdapters());
}

// ---------------------------------------------------------------------------
// Fan-out search
// ---------------------------------------------------------------------------

interface SearchResult {
  listings: NormalizedListing[];
  sourceErrors: Array<{ source: string; error: string }>;
  durationMs: number;
}

export async function runSearch(criteria: SearchCriteria): Promise<SearchResult> {
  ensureMonitorsRunning();

  const adapters = getAdapters();
  const start = Date.now();

  logger.info('search started', {
    city: criteria.city,
    neighborhood: criteria.neighborhood,
    purpose: criteria.purpose,
    sources: adapters.map((a) => a.name),
  });

  // Fan-out all sources in parallel with individual timeouts
  const settled = await Promise.allSettled(
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
  );

  const listings: NormalizedListing[] = [];
  const sourceErrors: Array<{ source: string; error: string }> = [];

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!;
    const source = adapters[i]!.name;

    if (result.status === 'fulfilled') {
      listings.push(...result.value);
      logger.info('source returned', { source, count: result.value.length });
    } else {
      const error = String(result.reason);
      sourceErrors.push({ source, error });
      logger.warn('source failed', { source, error });
    }
  }

  const durationMs = Date.now() - start;
  logger.info('search complete', {
    total: listings.length,
    durationMs,
    sourceErrors: sourceErrors.length,
  });

  return { listings, sourceErrors, durationMs };
}
