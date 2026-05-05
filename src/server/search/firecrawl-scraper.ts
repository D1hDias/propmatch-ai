import 'server-only';
import FirecrawlApp from '@mendable/firecrawl-js';
import { z } from 'zod';
import { logger } from '@/server/lib/logger';
import type { NormalizedListing, SearchCriteria } from './types';
import { extractAmenities } from './amenity-extractor';

let _firecrawl: FirecrawlApp | null = null;

function getFirecrawl(): FirecrawlApp {
  if (!_firecrawl) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY env var is not set');
    _firecrawl = new FirecrawlApp({ apiKey });
  }
  return _firecrawl;
}

// ---------------------------------------------------------------------------
// Schema for a single property listing
// ---------------------------------------------------------------------------

const listingSchema = z.object({
  externalId: z.string().optional(),
  url: z.string().url(),
  title: z.string().default(''),
  description: z.string().default(''),
  photos: z.array(z.string()).default([]),
  address: z.string().default(''),
  neighborhood: z.string().default(''),
  city: z.string().default(''),
  state: z.string().default(''),
  propertyType: z.string().default('apartment'),
  bedrooms: z.number().nullable().default(null),
  bathrooms: z.number().nullable().default(null),
  areaSqm: z.number().nullable().default(null),
  parkingSpots: z.number().nullable().default(null),
  price: z.number(),
  furnished: z.boolean().nullable().default(null),
  amenities: z.array(z.string()).default([]),
  lat: z.number().nullable().default(null),
  lng: z.number().nullable().default(null),
});

const pageSchema = z.object({
  listings: z.array(listingSchema).default([]),
});

type RawListing = z.infer<typeof listingSchema>;

// ---------------------------------------------------------------------------
// Scraper using Firecrawl scrapeUrl with JSON extraction
// ---------------------------------------------------------------------------

export async function scrapeWithFirecrawl(
  url: string,
  source: 'zap' | 'vivareal',
  criteria: SearchCriteria,
): Promise<NormalizedListing[]> {
  logger.info('firecrawl scrape start', { url, source });

  const result = await getFirecrawl().scrape(url, {
    formats: ['json'],
    jsonOptions: {
      prompt: `Extraia TODOS os imóveis listados nesta página de busca imobiliária brasileira.
Para cada imóvel retorne: url, title, description, photos (array de URLs), address, neighborhood, city, state, propertyType, bedrooms, bathrooms, areaSqm, parkingSpots, price (número em reais), furnished, amenities (array), lat, lng.
Não invente dados. Se um campo não existir, use null ou omita.`,
      schema: pageSchema,
    },
  });

  const parsed = pageSchema.safeParse((result as Record<string, unknown>).json);
  if (!parsed.success) {
    logger.warn('firecrawl schema parse failed', { error: parsed.error.message, url });
    return [];
  }

  logger.info('firecrawl listings extracted', { count: parsed.data.listings.length, source });
  return Promise.all(
    parsed.data.listings.map((item) => normalizeFirecrawlListing(item, source, criteria)),
  );
}

async function normalizeFirecrawlListing(
  item: RawListing,
  source: 'zap' | 'vivareal',
  criteria: SearchCriteria,
): Promise<NormalizedListing> {
  const extractedAmenities = await extractAmenities(item.description);

  let geohash7: string | null = null;
  if (item.lat && item.lng) {
    const ngeohash = await import('ngeohash');
    geohash7 = ngeohash.encode(item.lat, item.lng, 7);
  }

  return {
    source,
    externalId: item.externalId ?? item.url,
    url: item.url,
    title: item.title,
    description: item.description,
    photos: item.photos,
    address: item.address,
    neighborhood: item.neighborhood || criteria.neighborhood || '',
    city: item.city || criteria.city,
    state: item.state || 'SP',
    propertyType: item.propertyType,
    bedrooms: item.bedrooms,
    bathrooms: item.bathrooms,
    areaSqm: item.areaSqm,
    parkingSpots: item.parkingSpots,
    price: item.price,
    priceType: criteria.purpose === 'rent' ? 'rent' : 'sale',
    furnished: item.furnished,
    amenities: item.amenities,
    extractedAmenities,
    geohash7,
    lat: item.lat,
    lng: item.lng,
    scrapedAt: new Date().toISOString(),
  };
}
