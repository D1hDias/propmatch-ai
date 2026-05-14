import 'server-only';
import FirecrawlApp from '@mendable/firecrawl-js';
import { z } from 'zod';
import { logger } from '@/server/lib/logger';
import { callAnthropic } from '@/server/lib/anthropic';
import { MODELS } from '@/server/lib/models';
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
// LLM-based extraction from page markdown (our own LLM via OpenRouter)
//
// Strategy: Firecrawl renders the page and returns clean markdown. We then
// run our own LLM (Gemini via OpenRouter) to extract structured listings.
// This gives full control over price accuracy and filtering quality —
// Firecrawl's internal LLM was producing wrong prices in tests.
// ---------------------------------------------------------------------------

function buildExtractionSystemPrompt(criteria?: SearchCriteria): string {
  const parts = [
    `Você é um extrator especializado em dados imobiliários brasileiros.`,
    `Receberá o markdown de uma página de busca de imóveis. Extraia TODOS os imóveis listados e retorne JSON válido no formato: {"listings": [...]}`,
    ``,
    `REGRAS CRÍTICAS:`,
    `1. NUNCA invente, estime ou complete dados ausentes. Use null ou [] para campos não encontrados.`,
    `2. PRICE (campo price): extraia o valor EXATO em reais (número inteiro sem símbolos/pontuação).`,
    `   - "R$ 1.580.000" → 1580000`,
    `   - "R$ 799 mil" → 799000`,
    `   - "R$ 1,2 mi" → 1200000`,
    `   - JAMAIS use o orçamento do cliente como preço. O preço real pode ser maior.`,
    `3. URL: use a URL exata do link do imóvel, sem modificar. NUNCA invente URLs.`,
    `4. Para cada imóvel extraia: url, title, description, photos (array URLs absolutas),`,
    `   address, neighborhood, city, state, propertyType, listingType ("venda" ou "aluguel"),`,
    `   bedrooms (int), bathrooms (int), areaSqm (número), parkingSpots (int),`,
    `   price (inteiro em reais), furnished (boolean), amenities (array strings), lat, lng.`,
    `5. Responda SOMENTE com JSON. Sem markdown, sem texto antes ou depois.`,
  ];

  if (criteria) {
    if (criteria.purpose === 'buy') {
      parts.push(`6. EXTRAIA APENAS imóveis à VENDA. IGNORE aluguel/locação/temporada.`);
    } else if (criteria.purpose === 'rent') {
      parts.push(`6. EXTRAIA APENAS imóveis para ALUGUEL. IGNORE imóveis à venda.`);
    }
  }

  return parts.join('\n');
}

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
  /\/(venda|aluguel|comprar|alugar|sale|rent)\//i,
  /categoria|category|filtro|filter/i,
  // Path-based search patterns common in Brazilian portals
  /\/imoveis\/(venda|aluguel|comprar|alugar)/i,
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
  // URL with property-type keywords but no filter params is likely an individual listing
  if (/apartamento|casa|studio|kitnet|terreno|cobertura/i.test(url)) return 'listing';
  return 'other';
}

/**
 * Extracts structured listings from page markdown using our own LLM (via OpenRouter).
 * This replaces Firecrawl's internal LLM extraction which was producing wrong prices.
 */
async function extractListingsFromMarkdown(
  markdown: string,
  criteria: SearchCriteria,
): Promise<RawListing[]> {
  // Truncate to avoid very large context costs — Gemini 2.0 Flash handles ~30K tokens well
  const MAX_CHARS = 80_000;
  const truncated = markdown.length > MAX_CHARS ? markdown.slice(0, MAX_CHARS) : markdown;

  const system = buildExtractionSystemPrompt(criteria);

  let response: Awaited<ReturnType<typeof callAnthropic>>;
  try {
    response = await callAnthropic({
      model: MODELS.listingExtraction,
      system,
      prompt: truncated,
      maxTokens: 8192,
      timeoutMs: 90_000,
      maxAttempts: 2,
      jsonMode: true,
    });
  } catch (err) {
    logger.warn('extractListingsFromMarkdown LLM call failed', { error: String(err) });
    return [];
  }

  const text = response.content[0]?.text ?? '';
  if (!text) return [];

  try {
    const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = pageSchema.safeParse(JSON.parse(cleaned));
    if (!parsed.success) {
      logger.warn('extractListingsFromMarkdown schema parse failed', { error: parsed.error.message });
      return [];
    }
    return parsed.data.listings;
  } catch {
    logger.warn('extractListingsFromMarkdown JSON parse failed', { textSnippet: text.slice(0, 200) });
    return [];
  }
}

export async function scrapeWithFirecrawl(
  url: string,
  source: 'zap' | 'vivareal',
  criteria: SearchCriteria,
): Promise<NormalizedListing[]> {
  logger.info('firecrawl scrape start', { url, source });

  // Step 1: Firecrawl renders the page and returns clean markdown (no internal LLM).
  // Step 2: We run our own LLM (Gemini via OpenRouter) for structured extraction —
  //         this gives full control over price accuracy vs Firecrawl's internal LLM.
  let result: unknown;
  try {
    result = await getFirecrawl().scrape(url, {
      timeout: 90000,
      waitFor: 8000,
      formats: ['markdown'],
      proxy: 'stealth',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('SCRAPE_TIMEOUT') || msg.includes('timeout') || msg.includes('408')) {
      logger.warn('firecrawl timeout — skipping', { url });
      return [];
    }
    throw err;
  }

  const markdown = (result as Record<string, unknown>).markdown as string | undefined;
  if (!markdown || markdown.trim().length < 100) {
    logger.warn('firecrawl returned empty or very short markdown', { url, len: markdown?.length ?? 0 });
    return [];
  }

  logger.info('firecrawl markdown received', { url, chars: markdown.length });

  // Step 2: extract with our LLM
  const rawListings = await extractListingsFromMarkdown(markdown, criteria);

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

    // Separate search-result pages from individual listing pages
    const searchPages = allUrls.filter((u: string) => classifyUrl(u) === 'search');
    const listingPages = allUrls.filter((u: string) => classifyUrl(u) === 'listing');
    const otherPages = allUrls.filter((u: string) => classifyUrl(u) === 'other');

    logger.info('firecrawl map classified URLs', {
      url,
      total: allUrls.length,
      search: searchPages.length,
      listing: listingPages.length,
      other: otherPages.length,
      searchSamples: searchPages.slice(0, 3),
      listingSamples: listingPages.slice(0, 3),
    });

    // Prefer search pages (multiple listings per page), then individual listings,
    // then 'other' URLs as last resort — they might be search pages we didn't classify correctly.
    const toScrape: string[] =
      searchPages.length > 0
        ? searchPages.slice(0, maxSearchPages)
        : listingPages.length > 0
          ? listingPages.slice(0, maxListingPages)
          : otherPages.slice(0, 2); // last resort: try up to 2 unclassified pages

    if (toScrape.length === 0) {
      logger.warn('firecrawl map found no usable URLs', { url, totalLinksFromMap: rawLinks.length });
      return [];
    }

    logger.info('firecrawl map selected pages to scrape', {
      type: searchPages.length > 0 ? 'search' : 'listing',
      count: toScrape.length,
      urls: toScrape,
    });

    const results = await Promise.allSettled(
      toScrape.map((pageUrl) => scrapeWithFirecrawl(pageUrl, source, criteria)),
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
