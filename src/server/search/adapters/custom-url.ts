import 'server-only';
import { logger } from '@/server/lib/logger';
import type { NormalizedListing, SearchCriteria } from '../types';

// ---------------------------------------------------------------------------
// Generic URL scraper adapter
//
// Calls the scraper VPS with an arbitrary imobiliária URL. The VPS renders
// the page with Playwright, extracts text, then uses Claude to normalize
// the listing data into our standard shape.
//
// One adapter instance is created per custom URL. Each URL runs in parallel
// with the preset portal adapters inside runSearch's Promise.allSettled fan-out.
// ---------------------------------------------------------------------------

interface ScraperUrlRequest {
  url: string;
  criteria: {
    city: string;
    purpose: 'buy' | 'rent';
    bedroomsMin?: number | null;
    priceMax?: number | null;
  };
}

interface ScraperUrlResponse {
  listings: RawScrapedListing[];
  scrapedAt: string;
  error?: string;
}

interface RawScrapedListing {
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

async function callScraperVps(
  targetUrl: string,
  criteria: SearchCriteria,
): Promise<RawScrapedListing[]> {
  const scraperUrl = process.env.SCRAPER_VPS_URL;
  const scraperKey = process.env.SCRAPER_VPS_INTERNAL_KEY;

  if (!scraperUrl || !scraperKey) {
    throw new Error('custom-url: SCRAPER_VPS_URL or SCRAPER_VPS_INTERNAL_KEY not configured');
  }

  const body: ScraperUrlRequest = {
    url: targetUrl,
    criteria: {
      city: criteria.city,
      purpose: criteria.purpose,
      bedroomsMin: criteria.bedroomsMin,
      priceMax: criteria.priceMax,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${scraperUrl}/scrape-url`, {
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
      throw new Error(`scraper returned ${res.status}: ${text}`);
    }

    const data: ScraperUrlResponse = await res.json();

    if (data.error) {
      throw new Error(data.error);
    }

    return data.listings;
  } finally {
    clearTimeout(timeout);
  }
}

function normalize(raw: RawScrapedListing, scrapedAt: string): NormalizedListing {
  return {
    source: 'portal_x',
    externalId: raw.externalId || `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    url: raw.url,
    title: raw.title,
    description: raw.description,
    photos: raw.photos,
    address: raw.address,
    neighborhood: raw.neighborhood,
    city: raw.city,
    state: raw.state,
    propertyType: raw.propertyType || 'Apartamento',
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

/**
 * Scrapes a single user-provided URL and returns normalized listings.
 * Returns empty array (never throws) so one bad URL doesn't block the others.
 */
export async function scrapeCustomUrl(
  targetUrl: string,
  criteria: SearchCriteria,
): Promise<{ listings: NormalizedListing[]; url: string; error?: string }> {
  const hostname = (() => {
    try { return new URL(targetUrl).hostname; } catch { return targetUrl; }
  })();

  logger.info('custom-url scrape', { hostname });

  try {
    const raw = await callScraperVps(targetUrl, criteria);
    const scrapedAt = new Date().toISOString();
    const listings = raw.map((r) => normalize(r, scrapedAt));
    logger.info('custom-url returned', { hostname, count: listings.length });
    return { listings, url: targetUrl };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn('custom-url scrape failed', { hostname, error });
    return { listings: [], url: targetUrl, error };
  }
}
