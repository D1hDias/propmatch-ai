import 'server-only';
import { logger } from '@/server/lib/logger';

/**
 * Nominatim (OpenStreetMap) geocoder — free, no API key required.
 *
 * Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 *   - Max 1 request/second (we call only at ingestion time, not per search)
 *   - Must include descriptive User-Agent
 *   - Must not batch-geocode large datasets without caching
 *
 * We respect this by:
 *   1. Calling only when lat/lng is missing from portal data
 *   2. Caching results in-process (LRU, 2000 entries) — avoids duplicate calls
 *      for addresses seen across multiple scrape runs
 */

const USER_AGENT = 'PropMatch-AI/1.0 (propmatch.com.br; contact@propmatch.com.br)';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// Simple in-process LRU cache — evict oldest when full
const CACHE_MAX = 2000;
const cache = new Map<string, { lat: number; lng: number } | null>();

function cacheSet(key: string, value: { lat: number; lng: number } | null): void {
  if (cache.size >= CACHE_MAX) {
    // Delete oldest entry
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, value);
}

/**
 * Geocode a Brazilian property address.
 * Returns null if the address cannot be resolved or Nominatim is unreachable.
 * Never throws — geocoding failure is non-fatal for ingestion.
 */
export async function geocode(
  address: string,
  city: string,
  state: string,
): Promise<{ lat: number; lng: number } | null> {
  // Build a clean query: street address + city + state + Brazil
  const query = [address, city, state, 'Brasil']
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');

  const cacheKey = query.toLowerCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      limit: '1',
      countrycodes: 'br',
      addressdetails: '0',
    });

    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000), // 5s max
    });

    if (!res.ok) {
      logger.warn('nominatim non-ok response', { status: res.status, query });
      cacheSet(cacheKey, null);
      return null;
    }

    const data = (await res.json()) as Array<{ lat: string; lon: string }>;

    if (!data.length || !data[0]) {
      cacheSet(cacheKey, null);
      return null;
    }

    const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    cacheSet(cacheKey, result);

    // Respect 1 req/s policy — wait before allowing next call
    await new Promise((r) => setTimeout(r, 1100));

    return result;
  } catch (err) {
    logger.warn('nominatim geocode failed', { query, error: err });
    cacheSet(cacheKey, null);
    return null;
  }
}
