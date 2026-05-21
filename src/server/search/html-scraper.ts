import 'server-only';
import { logger } from '@/server/lib/logger';
import { extractAmenities } from './amenity-extractor';
import { getCityUF } from './city-lookup';
import type { NormalizedListing, SearchCriteria } from './types';

// ---------------------------------------------------------------------------
// HTML scraper — plain HTTP GET, no headless browser.
//
// Many Brazilian real estate sites built on the Kenlo platform (and others)
// are server-side rendered: a plain HTTP fetch returns full listing HTML while
// a headless browser gets blocked by a cookie consent wall. This scraper
// targets that pattern: fetch the HTML, parse structured JSON-LD, extract
// listing URLs, and return normalised results without any browser automation.
// ---------------------------------------------------------------------------

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// JSON-LD parsing helpers
// ---------------------------------------------------------------------------

type JsonLdBuyAction = {
  '@type': 'BuyAction';
  price?: string;
  object?: {
    '@type'?: string;
    name?: string;
    url?: string;
    image?: string;
    address?: {
      addressLocality?: string;
      streetAddress?: string;
      postalCode?: string;
    };
    geo?: { latitude?: number; longitude?: number };
  };
};

function extractJsonLdBlocks(html: string, type: string): JsonLdBuyAction[] {
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  const results: JsonLdBuyAction[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]!.trim()) as { '@type'?: string };
      if (obj['@type'] === type) results.push(obj as JsonLdBuyAction);
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return results;
}

// Parse area (m²) from listing name: "Apartamento de 153 m² na …"
function parseArea(name: string): number | null {
  const m = name.match(/de\s+(\d+)\s*m[²2]/i);
  return m ? parseInt(m[1]!, 10) : null;
}

// Parse property type from name or URL slug
function parsePropertyType(text: string): string {
  if (/cobertura/i.test(text)) return 'penthouse';
  if (/apartamento|duplex/i.test(text)) return 'apartment';
  if (/\bcasa\b/i.test(text)) return 'house';
  if (/studio|kitnet/i.test(text)) return 'studio';
  if (/\bsala\b/i.test(text)) return 'commercial';
  if (/terreno|lote/i.test(text)) return 'land';
  return 'apartment';
}

// Extract bedrooms from URL slug: "…-4-quartos-…" or short slug path
function parseBedroomsFromUrl(url: string): number | null {
  const m = url.match(/(\d+)-quartos/i) ?? url.match(/(\d+)-dorm/i);
  return m ? parseInt(m[1]!, 10) : null;
}

// Parse listing ID from URL: last path segment before trailing slash/query
function parseListingId(url: string): string {
  try {
    const p = new URL(url).pathname.replace(/\/$/, '');
    return p.split('/').pop() ?? url;
  } catch {
    return url.split('/').pop()?.split('?')[0] ?? url;
  }
}

// Parse price from JSON-LD price string: "R$ 1580000" or "1580000"
function parsePrice(raw: string | undefined): number {
  if (!raw) return 0;
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

// ---------------------------------------------------------------------------
// URL slug parsing — Kenlo's long slug encodes most listing fields.
// Format: /imovel/[type]-de-[area]-m-na-[street]-[neighborhood]-[city]-[state]-a-venda-por-r-[price]/[ID]
// ---------------------------------------------------------------------------

interface SlugData {
  id: string;
  url: string;
  propertyType: string;
  areaSqm: number | null;
  bedrooms: number | null;
  neighborhood: string;
  city: string;
  state: string;
  price: number;
  listingType: 'venda' | 'aluguel';
}

function parseKenloSlug(path: string, baseUrl: string, defaultListingType: 'venda' | 'aluguel' = 'venda'): SlugData | null {
  try {
    const parts = path.replace(/^\/+/, '').split('/');
    // Expected: ["imovel", "slug-with-data", "ID"] or ["imovel", "slug", "ID"]
    if (parts.length < 2) return null;
    const slugPart = parts[parts.length - 2] ?? '';
    const id = parts[parts.length - 1] ?? '';
    if (!id || !slugPart) return null;

    // Explicit rental indicators take precedence; explicit sale indicators next;
    // fall back to the page-level context (defaultListingType) when the slug is silent.
    const hasAluguel = /\b(aluguel|alugar|a-alugar|locacao|locação)\b/i.test(slugPart);
    const hasVenda = /\b(a-venda|venda|comprar)\b/i.test(slugPart);
    const listingType: 'venda' | 'aluguel' = hasAluguel ? 'aluguel' : hasVenda ? 'venda' : defaultListingType;

    // Price — two Kenlo formats:
    //   "por-r-1-580-000"  (dashes as thousand separators) → 1580000
    //   "por-r-61000000"   (sitemap format, centavos)       → 610000
    let price = 0;
    const priceM = slugPart.match(/por-r-([\d-]+)/i);
    if (priceM) {
      const raw = parseInt(priceM[1]!.replace(/-/g, ''), 10);
      // Sitemap URLs encode price in centavos (e.g. 61000000 = R$ 610.000).
      // Heuristic: if the parsed value > 10_000_000 and has no dashes, it's centavos.
      const hasDashes = /\d-\d/.test(priceM[1]!);
      price = !hasDashes && raw > 10_000_000 ? Math.round(raw / 100) : raw;
    }

    // Area — two formats:
    //   "de-153-m"  (old)  → 153
    //   "153-m2"    (new sitemap) → 153
    let areaSqm: number | null = null;
    const areaM = slugPart.match(/de-(\d+)-m/i) ?? slugPart.match(/(\d+)-m2/i) ?? slugPart.match(/(\d+)m2/i);
    if (areaM) areaSqm = parseInt(areaM[1]!, 10);

    // Bedrooms — two formats:
    //   "4-quartos" or "4-dorm"       (old)
    //   "com-2-dormitorios" or "com-2-quartos"  (new sitemap)
    const bedroomsFromSlug = parseBedroomsFromUrl(slugPart);
    const domM = slugPart.match(/com-(\d+)-dormitor/i) ?? slugPart.match(/com-(\d+)-quarto/i);
    const bedrooms = bedroomsFromSlug ?? (domM ? parseInt(domM[1]!, 10) : null);

    // Property type: first token
    const propertyType = parsePropertyType(slugPart);

    // Location: look for [city]-[state] pattern before "a-venda" or "a-alugar"
    // e.g. "barra-olimpica-rio-de-janeiro-rj-a-venda"
    const locPart = slugPart.split(/-(a-venda|a-alugar|a-locacao)/i)[0] ?? slugPart;
    // State is 2-letter code at end of locPart
    const stateM = locPart.match(/-([a-z]{2})$/i);
    const state = stateM ? stateM[1]!.toUpperCase() : '';
    // Remove state from locPart
    const withoutState = stateM ? locPart.slice(0, -3) : locPart;
    // Everything between the first segment past property type and end is neighborhood+city
    // This is heuristic — neighborhood is the segment before city
    const tokens = withoutState.split('-').filter(Boolean);
    const city = tokens.slice(-3).join(' '); // last 3 tokens approximation
    const neighborhood = tokens.slice(-6, -3).join(' ');

    return {
      id,
      url: `${baseUrl}/imovel/${slugPart}/${id}`,
      propertyType,
      areaSqm,
      bedrooms,
      neighborhood: neighborhood || '',
      city: city || '',
      state,
      price,
      listingType,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hard filter — same logic as firecrawl-scraper.ts
// ---------------------------------------------------------------------------

function passesHardFilter(l: Partial<NormalizedListing> & { bedrooms?: number | null; price?: number; listingType?: string }, criteria: SearchCriteria): boolean {
  if (criteria.purpose === 'buy' && l.listingType === 'aluguel') return false;
  if (criteria.purpose === 'rent' && l.listingType === 'venda') return false;
  if (criteria.bedroomsMin != null && l.bedrooms != null && l.bedrooms < criteria.bedroomsMin) return false;
  if (criteria.bedroomsMax != null && l.bedrooms != null && l.bedrooms > criteria.bedroomsMax) return false;
  if (criteria.priceMax != null && l.price != null && l.price > 0 && l.price > criteria.priceMax * 1.3) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Main export: fetch a search-results page and return normalised listings
// ---------------------------------------------------------------------------

export async function scrapeHtmlListings(
  pageUrl: string,
  criteria: SearchCriteria,
): Promise<NormalizedListing[]> {
  logger.info('html_scraper_start', { url: pageUrl });

  // Infer listing type from the page URL so slugs without explicit type markers
  // default correctly (e.g. /imoveis/a-venda → all listings are venda by default).
  const defaultListingType: 'venda' | 'aluguel' =
    /aluguel|alugar|a-alugar|locacao/i.test(pageUrl) ? 'aluguel' : 'venda';

  let html: string;
  try {
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      logger.warn('html_scraper_bad_response', { url: pageUrl, status: res.status });
      return [];
    }
    html = await res.text();
  } catch (err) {
    logger.warn('html_scraper_fetch_error', { url: pageUrl, error: String(err) });
    return [];
  }

  logger.info('html_scraper_html_fetched', { url: pageUrl, sizeBytes: html.length });

  if (html.length < 5000) {
    logger.warn('html_scraper_suspiciously_small', { url: pageUrl, sizeBytes: html.length });
    return [];
  }

  // Extract base URL for resolving relative links
  let baseUrl = '';
  try {
    const parsed = new URL(pageUrl);
    baseUrl = `${parsed.protocol}//${parsed.hostname}`;
  } catch { /* ignore */ }

  // Pre-pass: collect short URL slugs from the HTML and index bedrooms by listing ID.
  // Short slugs (/imovel/apartamento-rio-de-janeiro-4-quartos-153-m/ID) contain bedroom count
  // while long slugs (from JSON-LD) do not. Cross-referencing by ID fills the gap.
  const idToBedrooms = new Map<string, number>();
  const shortSlugRe = /href=["']?(\/imovel\/[^"'\s>]+)/gi;
  let sm: RegExpExecArray | null;
  while ((sm = shortSlugRe.exec(html)) !== null) {
    const path = sm[1] ?? '';
    const parts = path.split('/').filter(Boolean);
    const id = parts[parts.length - 1];
    const slug = parts[parts.length - 2] ?? '';
    if (id && slug) {
      const beds = parseBedroomsFromUrl(slug);
      if (beds != null) idToBedrooms.set(id, beds);
    }
  }

  // 1. Parse JSON-LD BuyAction blocks — most complete data source
  const jsonLdBlocks = extractJsonLdBlocks(html, 'BuyAction');
  logger.info('html_scraper_json_ld', { url: pageUrl, count: jsonLdBlocks.length });

  const jsonLdListings = new Map<string, Partial<NormalizedListing> & { bedrooms?: number | null; listingType?: 'venda' | 'aluguel' }>();
  for (const block of jsonLdBlocks) {
    const obj = block.object ?? {};
    const listingUrl = obj.url
      ? (obj.url.startsWith('http') ? obj.url : `${baseUrl}${obj.url}`)
      : '';
    if (!listingUrl) continue;

    const id = parseListingId(listingUrl);
    const name = obj.name ?? '';
    const price = parsePrice(block.price);
    const area = parseArea(name);
    // Prefer bedrooms from short URL index (has "4-quartos"), fall back to long URL parse
    const bedrooms = idToBedrooms.get(id) ?? parseBedroomsFromUrl(listingUrl) ?? null;
    const addr = obj.address ?? {};
    const hasAluguelInUrl = /aluguel|alugar|a-alugar/i.test(listingUrl);
    const hasVendaInUrl = /a-venda|venda|comprar/i.test(listingUrl);
    const listingType: 'venda' | 'aluguel' = hasAluguelInUrl ? 'aluguel' : hasVendaInUrl || (block.price ?? '').trim().length > 0 ? 'venda' : defaultListingType;

    const listing = {
      source: 'portal_x' as const,
      externalId: id,
      url: listingUrl,
      title: name,
      description: name,
      photos: obj.image ? [obj.image] : [],
      address: addr.streetAddress ?? '',
      neighborhood: addr.streetAddress ?? '',
      city: addr.addressLocality ?? criteria.city,
      state: getCityUF(addr.addressLocality ?? criteria.city) ?? '',
      propertyType: parsePropertyType(name),
      bedrooms,
      bathrooms: null,
      areaSqm: area,
      parkingSpots: null,
      price,
      priceType: criteria.purpose === 'rent' ? 'rent' as const : 'sale' as const,
      listingType,
      furnished: null,
      amenities: [],
      extractedAmenities: {} as Record<string, boolean>,
      geohash7: null,
      lat: obj.geo?.latitude ?? null,
      lng: obj.geo?.longitude ?? null,
      scrapedAt: new Date().toISOString(),
    };

    jsonLdListings.set(id, listing);
  }

  // 2. Parse all /imovel/ paths from HTML to catch listings without JSON-LD
  const pathRe = /href=["']?(\/imovel\/[^"'\s>]+)/gi;
  const seenIds = new Set(jsonLdListings.keys());
  const urlListings: Array<Partial<NormalizedListing> & { bedrooms?: number | null; listingType?: 'venda' | 'aluguel' }> = [];

  let match: RegExpExecArray | null;
  while ((match = pathRe.exec(html)) !== null) {
    const path = match[1];
    if (!path) continue;
    const slug = parseKenloSlug(path, baseUrl, defaultListingType);
    if (!slug || seenIds.has(slug.id)) continue;
    seenIds.add(slug.id);

    urlListings.push({
      source: 'portal_x' as const,
      externalId: slug.id,
      url: slug.url,
      title: `${slug.propertyType} – ${slug.neighborhood || slug.city}`,
      description: '',
      photos: [],
      address: '',
      neighborhood: slug.neighborhood,
      city: slug.city || criteria.city,
      state: slug.state || (getCityUF(slug.city || criteria.city) ?? ''),
      propertyType: slug.propertyType,
      bedrooms: slug.bedrooms,
      bathrooms: null,
      areaSqm: slug.areaSqm,
      parkingSpots: null,
      price: slug.price,
      priceType: criteria.purpose === 'rent' ? 'rent' as const : 'sale' as const,
      listingType: slug.listingType,
      furnished: null,
      amenities: [],
      extractedAmenities: {} as Record<string, boolean>,
      geohash7: null,
      lat: null,
      lng: null,
      scrapedAt: new Date().toISOString(),
    });
  }

  const all = [...jsonLdListings.values(), ...urlListings];
  const filtered = all.filter((l) => passesHardFilter(l, criteria));

  logger.info('html_scraper_results', {
    url: pageUrl,
    jsonLd: jsonLdListings.size,
    urlParsed: urlListings.length,
    total: all.length,
    afterFilter: filtered.length,
  });

  // Amenity extraction only for listings with descriptions (JSON-LD ones)
  return Promise.all(
    filtered.map(async (l) => {
      const extractedAmenities = l.description
        ? await extractAmenities(l.description).catch(() => ({} as Record<string, boolean>))
        : ({} as Record<string, boolean>);
      return { ...l, extractedAmenities } as NormalizedListing;
    }),
  );
}
