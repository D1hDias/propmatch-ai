import 'server-only';
import FirecrawlApp from '@mendable/firecrawl-js';
import { logger } from '@/server/lib/logger';

// ---------------------------------------------------------------------------
// Shared Firecrawl self-hosted client
//
// Single instance per process — reuse the connection.
// FIRECRAWL_API_URL must point to the self-hosted instance tunnel.
// FIRECRAWL_API_KEY can be any non-empty string for self-hosted.
// ---------------------------------------------------------------------------

let _client: FirecrawlApp | null = null;

export function getFirecrawl(): FirecrawlApp {
  if (!_client) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY env var is not set');
    _client = new FirecrawlApp({
      apiKey,
      apiUrl: process.env.FIRECRAWL_API_URL, // e.g. http://localhost:3002
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Health probe — verifies the self-hosted Firecrawl instance is reachable.
// Returns { healthy: true } on success, { healthy: false, error } on failure.
// ---------------------------------------------------------------------------

export async function checkFirecrawlHealth(): Promise<
  { healthy: true } | { healthy: false; error: string }
> {
  const apiUrl = process.env.FIRECRAWL_API_URL;
  if (!apiUrl) {
    return { healthy: false, error: 'FIRECRAWL_API_URL not configured' };
  }

  try {
    const res = await fetch(`${apiUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return { healthy: true };
    return { healthy: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      healthy: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Rate limiter — token bucket, 5 req/s per target hostname.
//
// Protects portal targets from being hit too aggressively.
// In-process only — resets on restart. Fine for single-VPS deployment.
// ---------------------------------------------------------------------------

const RATE_LIMIT_RPS = 5;
const BURST_MAX = 5;

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function acquireRateLimit(url: string): Promise<void> {
  const host = getHostname(url);
  const now = Date.now();

  let bucket = buckets.get(host);
  if (!bucket) {
    bucket = { tokens: BURST_MAX, lastRefill: now };
    buckets.set(host, bucket);
  }

  // Refill tokens proportional to elapsed time
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(BURST_MAX, bucket.tokens + elapsed * RATE_LIMIT_RPS);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return;
  }

  // Wait until one token is available
  const waitMs = Math.ceil(((1 - bucket.tokens) / RATE_LIMIT_RPS) * 1000);
  logger.debug('firecrawl rate limit wait', { host, waitMs });
  await new Promise<void>((resolve) => setTimeout(resolve, waitMs));

  // Consume the token we waited for
  bucket.tokens = 0;
  bucket.lastRefill = Date.now();
}
