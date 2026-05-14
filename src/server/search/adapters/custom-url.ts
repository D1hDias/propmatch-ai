import 'server-only';
import { logger } from '@/server/lib/logger';
import { scrapeWithFirecrawl, mapAndScrapeWithFirecrawl } from '../firecrawl-scraper';
import type { NormalizedListing, SearchCriteria } from '../types';

// ---------------------------------------------------------------------------
// Generic URL scraper adapter
//
// Strategy for homepage URLs (pathname === '/'):
//   1. Use Firecrawl MAP with criteria-based search to discover property
//      listing/search pages on the site.
//   2. Scrape each discovered page with a criteria-specific prompt.
//
// Strategy for already-filtered URLs (search results page):
//   1. Scrape the URL directly — user already applied filters.
//
// Fallback chain (when Firecrawl MAP or direct scrape returns 0):
//   Scraper VPS → Firecrawl direct → Firecrawl map+crawl
//
// Never throws — errors are returned in the result so one bad URL
// doesn't block the rest of the search.
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

/**
 * Returns true when the URL is a site homepage — no search filters applied.
 * In this case we should use MAP to discover listing pages rather than
 * scraping the homepage directly (which only shows featured/random properties).
 */
function isHomepageUrl(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    // Pathname is "/" or empty, and no meaningful query params
    const isRootPath = parsed.pathname === '/' || parsed.pathname === '';
    const hasNoFilters = parsed.searchParams.toString() === '';
    return isRootPath && hasNoFilters;
  } catch {
    return false;
  }
}

/**
 * Scrapes a single user-provided URL and returns normalized listings.
 *
 * When the URL is a site homepage, uses Firecrawl MAP to discover the
 * site's property listing/search pages and scrapes those instead.
 * This ensures the results are actual property listings, not just
 * whatever happens to be featured on the homepage.
 *
 * When the URL already has search filters (e.g. /busca?quartos=2),
 * scrapes it directly.
 */
export async function scrapeCustomUrl(
  targetUrl: string,
  criteria: SearchCriteria,
): Promise<{ listings: NormalizedListing[]; url: string; error?: string }> {
  const hostname = (() => {
    try { return new URL(targetUrl).hostname; } catch { return targetUrl; }
  })();

  logger.info('custom-url scrape start', { hostname, isHomepage: isHomepageUrl(targetUrl) });

  // 1. Try scraper VPS first (when configured)
  if (process.env.SCRAPER_VPS_URL && process.env.SCRAPER_VPS_INTERNAL_KEY) {
    try {
      const raw = await callScraperVps(targetUrl, criteria);
      const scrapedAt = new Date().toISOString();
      const listings = raw.map((r) => normalizeVpsListing(r, scrapedAt));
      logger.info('custom-url (VPS) returned', { hostname, count: listings.length });
      return { listings, url: targetUrl };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn('custom-url VPS failed, trying Firecrawl', { hostname, error });
    }
  }

  // 2. Firecrawl (primary when VPS not configured)
  if (process.env.FIRECRAWL_API_KEY) {
    try {
      let raw: NormalizedListing[] = [];

      if (isHomepageUrl(targetUrl)) {
        // Homepage: use MAP to discover the site's search/listing pages,
        // then scrape those with criteria-specific filtering.
        // This is far more effective than scraping the homepage which shows
        // random featured properties unrelated to the search criteria.
        logger.info('custom-url: homepage detected — using map+scrape', { hostname });
        raw = await mapAndScrapeWithFirecrawl(targetUrl, 'zap', criteria);

        // If MAP found nothing, fall back to direct scrape of the homepage
        if (raw.length === 0) {
          logger.info('custom-url: map returned 0, falling back to direct homepage scrape', { hostname });
          raw = await scrapeWithFirecrawl(targetUrl, 'zap', criteria);
        }
      } else {
        // Already a filtered/search URL — scrape it directly
        raw = await scrapeWithFirecrawl(targetUrl, 'zap', criteria);
      }

      // Re-label source as 'portal_x' to distinguish from real ZAP listings
      const relabeled = raw.map((l) => ({
        ...l,
        source: 'portal_x' as const,
        externalId: l.externalId || `custom-${hostname}-${l.url}`,
      }));
      logger.info('custom-url (Firecrawl) returned', { hostname, count: relabeled.length });
      return { listings: relabeled, url: targetUrl };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn('custom-url Firecrawl failed', { hostname, error });
      return { listings: [], url: targetUrl, error };
    }
  }

  const error = 'custom-url: nenhum scraper configurado (SCRAPER_VPS_URL ou FIRECRAWL_API_KEY ausentes)';
  logger.warn('custom-url: no scraper configured', { hostname });
  return { listings: [], url: targetUrl, error };
}

function normalizeVpsListing(raw: RawScrapedListing, scrapedAt: string): NormalizedListing {
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
