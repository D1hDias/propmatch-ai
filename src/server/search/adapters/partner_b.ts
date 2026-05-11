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
// Partner B API client
// REST JSON API provided by the partner. Disabled by default (feature flag).
// Enable with FEATURE_SOURCE_PARTNER_B=true in env.
// ---------------------------------------------------------------------------

interface PartnerBListing {
  id: string;
  listing_url: string;
  headline: string;
  description_text: string;
  image_urls: string[];
  full_address: string;
  district: string;
  city_name: string;
  state_code: string;
  category: string;
  rooms: number | null;
  baths: number | null;
  area_m2: number | null;
  garages: number | null;
  asking_price: number;
  transaction_type: 'VENDA' | 'LOCACAO';
  is_furnished: boolean | null;
  features: string[];
  latitude: number | null;
  longitude: number | null;
  published_at: string;
}

interface PartnerBResponse {
  results: PartnerBListing[];
  page: number;
  total_pages: number;
}

async function fetchPage(
  baseUrl: string,
  apiKey: string,
  criteria: SearchCriteria,
  page: number,
): Promise<PartnerBResponse> {
  const params = new URLSearchParams({
    city: criteria.city,
    page: String(page),
    per_page: '20',
    transaction: criteria.purpose === 'buy' ? 'VENDA' : 'LOCACAO',
  });
  if (criteria.neighborhood) params.set('district', criteria.neighborhood);
  if (criteria.propertyType) params.set('category', criteria.propertyType);
  if (criteria.bedroomsMin != null) params.set('rooms_min', String(criteria.bedroomsMin));
  if (criteria.priceMin != null) params.set('price_min', String(criteria.priceMin));
  if (criteria.priceMax != null) params.set('price_max', String(criteria.priceMax));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${baseUrl}/listings?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`partner_b API returned ${res.status}: ${text}`);
    }

    return res.json() as Promise<PartnerBResponse>;
  } finally {
    clearTimeout(timeout);
  }
}

function normalize(raw: PartnerBListing): NormalizedListing {
  return {
    source: 'partner_b',
    externalId: raw.id,
    url: raw.listing_url,
    title: raw.headline,
    description: raw.description_text,
    photos: raw.image_urls,
    address: raw.full_address,
    neighborhood: raw.district,
    city: raw.city_name,
    state: raw.state_code,
    propertyType: raw.category,
    bedrooms: raw.rooms,
    bathrooms: raw.baths,
    areaSqm: raw.area_m2,
    parkingSpots: raw.garages,
    price: raw.asking_price,
    priceType: raw.transaction_type === 'VENDA' ? 'sale' : 'rent',
    furnished: raw.is_furnished,
    amenities: raw.features,
    extractedAmenities: {},
    geohash7: null,
    lat: raw.latitude,
    lng: raw.longitude,
    scrapedAt: raw.published_at,
  };
}

// ---------------------------------------------------------------------------
// Partner B adapter (Source 3 — feature-flagged OFF by default)
// ---------------------------------------------------------------------------

export const partnerBAdapter: SourceAdapter = {
  name: 'partner_b',

  async search(criteria: SearchCriteria): Promise<NormalizedListing[]> {
    const baseUrl = process.env.PARTNER_B_API_URL;
    const apiKey = process.env.PARTNER_B_API_KEY;

    if (!baseUrl || !apiKey) {
      logger.warn('partner_b: env vars not configured — returning empty');
      return [];
    }

    logger.info('partner_b search', { city: criteria.city, purpose: criteria.purpose });

    try {
      // Fetch up to 2 pages (40 results) to stay within latency budget
      const [page1, page2] = await Promise.allSettled([
        fetchPage(baseUrl, apiKey, criteria, 1),
        fetchPage(baseUrl, apiKey, criteria, 2),
      ]);

      const listings: NormalizedListing[] = [];

      if (page1.status === 'fulfilled') {
        listings.push(...page1.value.results.map(normalize));
      } else {
        throw page1.reason;
      }

      if (page2.status === 'fulfilled' && page2.value.results.length > 0) {
        listings.push(...page2.value.results.map(normalize));
      }

      recordResult(true);
      logger.info('partner_b returned', { count: listings.length });
      return listings;
    } catch (err) {
      recordResult(false);
      logger.error('partner_b search failed', { error: err, city: criteria.city });
      return [];
    }
  },

  async healthCheck(): Promise<HealthStatus> {
    const rate = successRate();
    return {
      source: 'partner_b',
      healthy: rate >= 0.8,
      successRate: rate,
      lastCheckedAt: new Date().toISOString(),
      message: rate < 0.8 ? 'Success rate below 80% — check Partner B API status' : undefined,
    };
  },
};
