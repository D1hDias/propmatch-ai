import 'server-only';
import { logger } from '@/server/lib/logger';
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
// Scraper VPS client
// Calls our dedicated scraper VPS via authenticated
// internal REST API. The VPS URL and key come from env vars so we can
// point dev at a local scraper without code changes.
// ---------------------------------------------------------------------------

interface ScraperRequest {
  portal: 'portal_x';
  city: string;
  neighborhood?: string | null;
  propertyType?: string | null;
  bedroomsMin?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  areaMin?: number | null;
  purpose: 'buy' | 'rent';
  maxPages: number;
}

interface ScraperListing {
  externalId: string;
  url: string;
  title: string;
  description: string;
  photos: string[];
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  propertyType: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  parkingSpots: number | null;
  price: number;
  priceType: 'sale' | 'rent';
  furnished: boolean | null;
  amenities: string[];
  lat: number | null;
  lng: number | null;
}

interface ScraperResponse {
  listings: ScraperListing[];
  scrapedAt: string;
}

async function callScraperVps(criteria: SearchCriteria): Promise<ScraperListing[]> {
  const scraperUrl = process.env.SCRAPER_VPS_URL;
  const scraperKey = process.env.SCRAPER_VPS_INTERNAL_KEY;

  if (!scraperUrl || !scraperKey) {
    throw new Error('portal_x: SCRAPER_VPS_URL or SCRAPER_VPS_INTERNAL_KEY not configured');
  }

  const body: ScraperRequest = {
    portal: 'portal_x',
    city: criteria.city,
    neighborhood: criteria.neighborhood,
    propertyType: criteria.propertyType,
    bedroomsMin: criteria.bedroomsMin,
    priceMin: criteria.priceMin,
    priceMax: criteria.priceMax,
    areaMin: criteria.areaMin,
    purpose: criteria.purpose,
    maxPages: 3,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(`${scraperUrl}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': scraperKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`portal_x scraper returned ${res.status}: ${text}`);
    }

    const data: ScraperResponse = await res.json();
    return data.listings;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Normalize scraper listing → NormalizedListing
// ---------------------------------------------------------------------------

function normalize(raw: ScraperListing, scrapedAt: string): NormalizedListing {
  return {
    source: 'portal_x',
    externalId: raw.externalId,
    url: raw.url,
    title: raw.title,
    description: raw.description,
    photos: raw.photos,
    address: raw.address,
    neighborhood: raw.neighborhood,
    city: raw.city,
    state: raw.state,
    propertyType: raw.propertyType,
    bedrooms: raw.bedrooms,
    bathrooms: raw.bathrooms,
    areaSqm: raw.areaSqm,
    parkingSpots: raw.parkingSpots,
    price: raw.price,
    priceType: raw.priceType,
    furnished: raw.furnished,
    amenities: raw.amenities,
    extractedAmenities: {},
    geohash7: null,
    lat: raw.lat,
    lng: raw.lng,
    scrapedAt,
  };
}

// ---------------------------------------------------------------------------
// PortalX adapter
// ---------------------------------------------------------------------------

export const portalXAdapter: SourceAdapter = {
  name: 'portal_x',

  async search(criteria: SearchCriteria): Promise<NormalizedListing[]> {
    logger.info('portal_x search', { city: criteria.city, purpose: criteria.purpose });

    try {
      const raw = await callScraperVps(criteria);
      const scrapedAt = new Date().toISOString();
      const listings = raw.map((r) => normalize(r, scrapedAt));
      recordResult(true);
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
      message: rate < 0.8 ? 'Success rate below 80% — scraper VPS may be unhealthy' : undefined,
    };
  },
};
