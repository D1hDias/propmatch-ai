import 'server-only';
import FirecrawlApp from '@mendable/firecrawl-js';
import { z } from 'zod';
import { getCityUF } from './city-lookup';
import { logger } from '@/server/lib/logger';
import type { NormalizedListing, SearchCriteria } from './types';
import { extractAmenities } from './amenity-extractor';
import { scrapeHtmlListings } from './html-scraper';

let _firecrawl: FirecrawlApp | null = null;

function getFirecrawl(): FirecrawlApp {
  if (!_firecrawl) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY env var is not set');
    _firecrawl = new FirecrawlApp({ apiKey, apiUrl: process.env.FIRECRAWL_API_URL });
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
  listingType: z.enum(['venda', 'aluguel']).nullable().default(null),
  bedrooms: z.number().nullable().default(null),
  bathrooms: z.number().nullable().default(null),
  areaSqm: z.number().nullable().default(null),
  parkingSpots: z.number().nullable().default(null),
  // Accept price as number or string — LLMs sometimes return "850000" or "R$ 850.000"
  price: z.preprocess(
    (v) => typeof v === 'string' ? Number(v.replace(/[^\d]/g, '')) : v,
    z.number().default(0),
  ),
  furnished: z.boolean().nullable().default(null),
  amenities: z.array(z.string()).default([]),
  lat: z.number().nullable().default(null),
  lng: z.number().nullable().default(null),
});

// Individual listing failures must not kill the entire page batch.
// Parse each item independently so one malformed listing doesn't discard the rest.
const pageSchema = z.object({
  listings: z.array(z.unknown()).default([]).transform((items) =>
    items.flatMap((item) => {
      const r = listingSchema.safeParse(item);
      return r.success ? [r.data] : [];
    }),
  ),
});

type RawListing = z.infer<typeof listingSchema>;

// ---------------------------------------------------------------------------
// Firecrawl native JSON extraction
//
// Strategy: Firecrawl renders the page AND extracts structured data using its
// own built-in AI (jsonOptions). No second LLM call via OpenRouter needed.
// ---------------------------------------------------------------------------

function buildExtractionPrompt(criteria: SearchCriteria): string {
  const purpose = criteria.purpose === 'rent'
    ? 'ALUGUEL. Ignore imóveis à venda.'
    : 'VENDA. Ignore aluguel/locação/temporada.';

  return [
    'Extraia TODOS os imóveis listados nesta página de busca imobiliária brasileira.',
    `Extraia APENAS imóveis para ${purpose}`,
    'Para cada imóvel: url (link direto do anúncio, não URL de imagem), title, description,',
    'address, neighborhood, city, state, propertyType, listingType (venda ou aluguel),',
    'bedrooms (inteiro), bathrooms (inteiro), areaSqm (número), parkingSpots (inteiro),',
    'price (inteiro em reais, sem símbolos: "R$ 1.580.000" → 1580000, "R$ 799 mil" → 799000),',
    'furnished (boolean), amenities (array de strings), lat, lng.',
    'NUNCA invente dados. Use null para campos ausentes.',
  ].join(' ');
}

const LISTING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    listings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url:          { type: 'string' },
          title:        { type: 'string' },
          description:  { type: 'string' },
          address:      { type: 'string' },
          neighborhood: { type: 'string' },
          city:         { type: 'string' },
          state:        { type: 'string' },
          propertyType: { type: 'string' },
          listingType:  { type: 'string' },
          bedrooms:     { type: 'number' },
          bathrooms:    { type: 'number' },
          areaSqm:      { type: 'number' },
          parkingSpots: { type: 'number' },
          price:        { type: 'number' },
          furnished:    { type: 'boolean' },
          amenities:    { type: 'array', items: { type: 'string' } },
          lat:          { type: 'number' },
          lng:          { type: 'number' },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Hard filter — applied after JSON extraction, before normalization.
// Removes listings that clearly violate hard constraints (bedrooms, price),
// and discards hallucinated/placeholder URLs that the LLM invents when it
// cannot find real data on the page.
// ---------------------------------------------------------------------------

// Domains the LLM commonly hallucinates as placeholder examples
const HALLUCINATED_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net',
  'test.com', 'test.org', 'localhost',
  'placeholder.com', 'domain.com', 'site.com',
  'imoveis.com.br',   // generic catch-all, not a real portal
  'imobiliaria.com.br',
]);

// Path patterns that betray a hallucinated single-property placeholder
const PLACEHOLDER_PATH_RE = [
  /\/imovel-\d+\/?$/i,      // /imovel-1
  /\/imovel\d{4,}\/?$/i,    // /imovel12345
  /\/property-\d+\/?$/i,    // /property-1
  /\/listing-\d+\/?$/i,     // /listing-1
  /\/imovel-exemplo/i,
  /\/example/i,
  /\/sample/i,
];

function isHallucinatedUrl(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    const bare = hostname.replace(/^www\./, '');
    if (HALLUCINATED_DOMAINS.has(bare)) return true;
    if (PLACEHOLDER_PATH_RE.some((re) => re.test(pathname))) return true;
    return false;
  } catch {
    return true; // invalid URL → discard
  }
}

type RawListingForFilter = Pick<
  z.infer<typeof listingSchema>,
  'url' | 'bedrooms' | 'areaSqm' | 'price' | 'propertyType' | 'listingType'
>;

function hardFilter<T extends RawListingForFilter>(
  listings: T[],
  criteria: SearchCriteria,
): T[] {
  return listings.filter((l) => {
    // Discard hallucinated/placeholder URLs
    if (isHallucinatedUrl(l.url)) return false;

    // Purpose filter: when searching for sale ('buy'), discard rental listings
    if (criteria.purpose === 'buy' && l.listingType === 'aluguel') return false;
    // When searching for rent, discard sale listings
    if (criteria.purpose === 'rent' && l.listingType === 'venda') return false;

    // Bedrooms hard constraints
    if (criteria.bedroomsMin != null && l.bedrooms != null) {
      if (l.bedrooms < criteria.bedroomsMin) return false;
    }
    if (criteria.bedroomsMax != null && l.bedrooms != null) {
      if (l.bedrooms > criteria.bedroomsMax) return false;
    }

    // Area hard constraint — only when explicitly specified
    if (criteria.areaMin != null && l.areaSqm != null) {
      if (l.areaSqm < criteria.areaMin) return false;
    }

    // Price: only filter when explicitly specified; allow 30% tolerance for data noise
    if (criteria.priceMax != null && l.price > 0) {
      if (l.price > criteria.priceMax * 1.3) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// URL classification — prefer search-result pages over individual listings
// ---------------------------------------------------------------------------

// A "search page" lists multiple properties filtered by criteria — scraping
// one of these returns dozens of listings in a single call.
const SEARCH_PAGE_PATTERNS = [
  /busca|search|resultado|listing|lista/i,
  // Brazilian real estate query params (finalidade, tipo, quartos, valor, etc.)
  /\?(finalidade|quartos|bedrooms|tipo|bairro|preco|price|min|max|valor|dormit)/i,
  // Includes "a-venda" (the Portuguese "for sale" preposition form) and "para-alugar"
  /\/(a-venda|venda|aluguel|comprar|alugar|para-alugar|sale|rent)\//i,
  /categoria|category|filtro|filter/i,
  // Path-based search patterns common in Brazilian portals
  /\/imoveis\/(a-venda|venda|aluguel|comprar|alugar|para-alugar)/i,
  /\/busca-imoveis|\/busca-avancada|\/pesquisa/i,
];

// An "individual listing" page shows a single property — less useful for batch extraction.
// NOTE: /imoveis/ alone is NOT a listing page — it's often the search results index.
const INDIVIDUAL_LISTING_PATTERNS = [
  /\/imovel\/[^/]+\/|\/imovel\/\d/i,   // /imovel/slug or /imovel/12345 (not bare /imovel/)
  /\/imóvel\/[^/]+\//i,
  /\/[a-z]+-[a-z]+-\d{5,}/i,           // slug-with-long-id (≥5 digits to avoid false positives)
  /\/detalhe|\/detail|\/single/i,
];

type UrlClass = 'search' | 'listing' | 'other';

function classifyUrl(url: string): UrlClass {
  // Search patterns checked first — a URL with filter params is always a search page,
  // even if its path also matches an individual listing pattern (e.g. /imoveis/?quartos=2).
  if (SEARCH_PAGE_PATTERNS.some((p) => p.test(url))) return 'search';
  if (INDIVIDUAL_LISTING_PATTERNS.some((p) => p.test(url))) return 'listing';
  // Property-type keywords appear in both search filter paths (/apartamento/sao-paulo/)
  // and individual listing slugs (/apartamento-3-quartos-12345). Distinguish by presence
  // of a ≥5-digit numeric ID — that signals a single listing, not a filter segment.
  if (/apartamento|casa|studio|kitnet|terreno|cobertura/i.test(url)) {
    return /\/\d{5,}/.test(url) ? 'listing' : 'search';
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// Sitemap XML fetching — bypasses cookie consent walls entirely.
// Many Brazilian real estate sites (e.g. Kenlo platform) expose sitemap XMLs
// that list property URLs directly. Fetching the XML requires no JS rendering
// and no cookie consent interaction.
// ---------------------------------------------------------------------------

async function fetchSitemapUrls(sitemapUrl: string): Promise<string[]> {
  try {
    const res = await fetch(sitemapUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PropMatch/1.0 +https://propmatch.ai)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const matches = xml.match(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi) ?? [];
    return matches
      .map((m) => m.replace(/<\/?loc>/gi, '').trim())
      .filter((u) => !u.match(/\.xml(\?|$)/i)); // exclude nested sitemaps
  } catch {
    return [];
  }
}

export async function scrapeWithFirecrawl(
  url: string,
  source: 'zap' | 'vivareal',
  criteria: SearchCriteria,
): Promise<NormalizedListing[]> {
  logger.info('firecrawl scrape start', { url, source });

  // Firecrawl renders the page AND extracts structured JSON using its own built-in AI.
  // No separate OpenRouter LLM call needed — Firecrawl handles both rendering and extraction.
  let result: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scrapeOptions: any = {
      timeout: 90000,
      waitFor: 5000,
      formats: [{ type: 'json', prompt: buildExtractionPrompt(criteria), schema: LISTING_JSON_SCHEMA }],
      proxy: 'stealth',
      // Actions (scroll/click for LGPD banners) require Fire Engine which is not available
      // in the self-hosted instance. Omitted intentionally — the self-hosted Playwright
      // worker handles JS rendering without explicit action sequences.
    };
    result = await getFirecrawl().scrape(url, scrapeOptions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('SCRAPE_TIMEOUT') || msg.includes('timeout') || msg.includes('408')) {
      logger.warn('firecrawl timeout — skipping', { url });
      return [];
    }
    throw err;
  }

  const json = (result as Record<string, unknown>).json as Record<string, unknown> | undefined;
  if (!json) {
    logger.warn('firecrawl returned no json', { url });
    return [];
  }

  logger.info('firecrawl json received', { url });

  const parsed = pageSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn('firecrawl json schema parse failed', { url, error: parsed.error.message });
    return [];
  }

  const rawListings = parsed.data.listings;
  const beforeFilter = rawListings.length;
  const filtered = hardFilter(rawListings, criteria);
  if (filtered.length < beforeFilter) {
    logger.info('firecrawl hard filter removed listings', {
      removed: beforeFilter - filtered.length,
      remaining: filtered.length,
      source,
    });
  }

  logger.info('firecrawl listings extracted', { count: filtered.length, source });
  return Promise.all(
    filtered.map((item) => normalizeFirecrawlListing(item, source, criteria)),
  );
}

/**
 * Uses Firecrawl MAP to discover the site's search/listing pages, then scrapes
 * the best ones with criteria-specific JSON extraction.
 *
 * Strategy:
 *   1. MAP with a rich criteria-based search query.
 *   2. Classify found URLs: prefer "search pages" (listing grids) over
 *      individual property detail pages — one search page yields many listings.
 *   3. Scrape up to 2 search pages; fall back to up to 3 individual listings
 *      if no search pages are found.
 */
export async function mapAndScrapeWithFirecrawl(
  url: string,
  source: 'zap' | 'vivareal',
  criteria: SearchCriteria,
  maxSearchPages = 2,
  maxListingPages = 3,
): Promise<NormalizedListing[]> {
  logger.info('firecrawl map start', { url, source });

  try {
    // Build a rich search query so MAP finds pages relevant to the criteria
    const mapSearch = [
      criteria.purpose === 'buy' ? 'venda comprar' : 'aluguel alugar',
      criteria.city,
      criteria.neighborhood ?? '',
      criteria.bedroomsMin != null ? `${criteria.bedroomsMin} quartos` : '',
      criteria.propertyType ?? '',
    ].filter(Boolean).join(' ').trim() || undefined;

    const mapData = await getFirecrawl().map(url, {
      limit: 60,
      sitemap: 'include',
      search: mapSearch,
    });

    // Firecrawl SDK map() returns links as string[] — not {url: string}[]
    const rawLinks: unknown[] = mapData.links ?? [];
    const allUrls = rawLinks
      .map((l) => (typeof l === 'string' ? l : (l as { url?: string }).url ?? ''))
      .filter((u) => u && u !== url);

    // Detect sitemap XML URLs — fetch these directly (no JS, no cookie consent)
    // to get individual property URLs. Common on Kenlo-platform sites.
    const sitemapXmlUrls = allUrls.filter((u) => u.match(/\.xml(\?|$)/i));
    let sitemapListingUrls: string[] = [];
    if (sitemapXmlUrls.length > 0) {
      logger.info('firecrawl map found sitemap XMLs — fetching property URLs', {
        sitemaps: sitemapXmlUrls.slice(0, 3),
      });
      const sitemapResults = await Promise.allSettled(
        sitemapXmlUrls.slice(0, 2).map(fetchSitemapUrls),
      );
      for (const r of sitemapResults) {
        if (r.status === 'fulfilled') sitemapListingUrls.push(...r.value);
      }
      logger.info('firecrawl sitemap property URLs fetched', { count: sitemapListingUrls.length });
    }

    // Separate search-result pages from individual listing pages
    const searchPages = allUrls.filter((u: string) => classifyUrl(u) === 'search');
    const listingPages = sitemapListingUrls.length > 0
      // Sitemap URLs are pre-classified as individual listings — use them when available
      ? sitemapListingUrls
      : allUrls.filter((u: string) => classifyUrl(u) === 'listing');
    const otherPages = allUrls.filter((u: string) => classifyUrl(u) === 'other');

    logger.info('firecrawl map classified URLs', {
      url,
      total: allUrls.length,
      search: searchPages.length,
      listing: listingPages.length,
      sitemapUsed: sitemapListingUrls.length > 0,
      other: otherPages.length,
      searchSamples: searchPages.slice(0, 3),
      listingSamples: listingPages.slice(0, 3),
    });

    // Prefer search pages (multiple listings per page), then individual listings
    // (from sitemap if available — bypasses cookie consent), then 'other' as last resort.
    const toScrape: string[] =
      searchPages.length > 0
        ? searchPages.slice(0, maxSearchPages)
        : listingPages.length > 0
          ? listingPages.slice(0, maxListingPages)
          : otherPages.slice(0, 2); // last resort: try up to 2 unclassified pages

    if (toScrape.length === 0) {
      logger.warn('firecrawl map found no usable URLs — trying HTML scraper on common search paths', {
        url,
        totalLinksFromMap: rawLinks.length,
      });
      // Kenlo-platform sites block headless MAP but serve full SSR HTML to plain GET.
      // The homepage often has 0 JSON-LD blocks; search-result sub-pages (e.g. /imoveis/a-venda)
      // carry the BuyAction structured data. Try them in order.
      const baseRoot = url.replace(/\/+$/, '');
      const candidatePaths = [
        criteria.purpose === 'buy' ? '/imoveis/a-venda' : '/imoveis/aluguel',
        '/imoveis',
        '', // last resort: the entry URL itself
      ];
      for (const p of candidatePaths) {
        const candidateUrl = `${baseRoot}${p}`;
        const listings = await scrapeHtmlListings(candidateUrl, criteria);
        if (listings.length > 0) {
          logger.info('html_scraper_common_path_fallback_succeeded', { url: candidateUrl, count: listings.length });
          return listings;
        }
        logger.info('html_scraper_common_path_empty', { url: candidateUrl });
      }
      logger.warn('html_scraper_all_fallbacks_empty', { url });
      return [];
    }

    logger.info('firecrawl map selected pages to scrape', {
      type: searchPages.length > 0 ? 'search' : 'listing',
      count: toScrape.length,
      urls: toScrape,
    });

    // Try HTML fetch first (bypasses cookie consent walls on SSR sites).
    // Falls back to Firecrawl headless scraping when HTML returns nothing.
    const results = await Promise.allSettled(
      toScrape.map(async (pageUrl) => {
        const htmlListings = await scrapeHtmlListings(pageUrl, criteria);
        if (htmlListings.length > 0) {
          logger.info('html_scraper_succeeded', { url: pageUrl, count: htmlListings.length });
          return htmlListings;
        }
        logger.info('html_scraper_no_results_falling_back_to_firecrawl', { url: pageUrl });
        return scrapeWithFirecrawl(pageUrl, source, criteria);
      }),
    );

    const allListings: NormalizedListing[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allListings.push(...r.value);
    }
    logger.info('firecrawl map+scrape total', { count: allListings.length, source });
    return allListings;
  } catch (err) {
    logger.warn('firecrawl map failed', { url, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
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
    state: item.state || getCityUF(item.city || criteria.city) || '',
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
