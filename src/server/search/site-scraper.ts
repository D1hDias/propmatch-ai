import 'server-only';
import { logger } from '@/server/lib/logger';
import { callLLM } from '@/server/lib/llm';
import { MODELS } from '@/server/lib/models';
import { getFirecrawl, acquireRateLimit } from './firecrawl-client';
import type { NormalizedListing, SearchCriteria } from './types';

// ---------------------------------------------------------------------------
// Firecrawl-based scraper for partner real estate sites.
//
// All scraping uses formats:['markdown'] or formats:['markdown','links'].
// Firecrawl's JSON schema format (type:'json') uses Playwright internally and
// triggers anti-bot protection on most real estate sites — avoid it.
//
// Strategy types:
//
//   'firecrawl_json'   — One markdown scrape on the search-results URL, then
//                        our LLM extracts all listings. Best for sites whose
//                        search page lists full card data (imoveisnewhome).
//
//   'firecrawl_links'  — Get listing links from the search page, then scrape
//                        each individual listing page with markdown + our LLM.
//                        Best for sites with sparse card data (karioca).
//
// Smart search (searchConfig field on PartnerSite):
//
//   { type: 'karioca_api' }
//     — Calls Karioca's /buscar JSON API directly (no Firecrawl for the search
//       step, saving credits). Maps SearchCriteria to neighborhood IDs,
//       paginates, then scrapes individual pages.
//
//   { type: 'markers_extract' }
//     — For WordPress sites that embed all property data as a JS `markers`
//       array in the page HTML. Filters in-code by bairro + price, then
//       scrapes individual listing pages.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Raw Firecrawl listing → NormalizedListing
// ---------------------------------------------------------------------------

function toNormalized(
  raw: Record<string, unknown>,
  sourceUrl: string,
  domain: string,
  listingUrl: string,
  criteria: SearchCriteria,
): NormalizedListing {
  const price = typeof raw.price === 'number' ? raw.price : 0;
  const bedrooms = typeof raw.bedrooms === 'number' ? raw.bedrooms : null;
  const bathrooms = typeof raw.bathrooms === 'number' ? raw.bathrooms : null;
  const areaSqm = typeof raw.area_sqm === 'number' ? raw.area_sqm : null;
  const parking = typeof raw.parking === 'number' ? raw.parking : null;

  return {
    source: 'portal_x' as const,
    externalId: listingUrl,
    url: listingUrl,
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    photos: raw.image_url ? [String(raw.image_url)] : [],
    address: '',
    neighborhood: String(raw.neighborhood ?? ''),
    city: String(raw.city ?? criteria.city),
    state: criteria.state ?? '',
    propertyType: mapPropertyType(String(raw.property_type ?? 'apartment')),
    bedrooms,
    bathrooms,
    areaSqm,
    parkingSpots: parking,
    price,
    priceType: criteria.purpose === 'rent' ? 'rent' as const : 'sale' as const,
    furnished: null,
    amenities: [],
    extractedAmenities: {} as Record<string, boolean>,
    geohash7: null,
    lat: null,
    lng: null,
    scrapedAt: new Date().toISOString(),
  };
}

function mapPropertyType(raw: string): NormalizedListing['propertyType'] {
  const t = raw.toLowerCase();
  if (t.includes('cobertura') || t.includes('penthouse')) return 'penthouse';
  if (t.includes('apartamento') || t.includes('apartment')) return 'apartment';
  if (t.includes('casa') || t.includes('house')) return 'house';
  if (t.includes('studio') || t.includes('kitnet')) return 'studio';
  if (t.includes('sala') || t.includes('commercial')) return 'commercial';
  if (t.includes('terreno') || t.includes('land') || t.includes('lote')) return 'land';
  return 'apartment';
}

// System prompt used by scrapeSearchPage to extract listings from markdown.
// Uses markdown+links (simple HTTP fetch) to avoid Playwright/anti-bot triggers.
const SEARCH_PAGE_EXTRACT_PROMPT =
  'Você é um extrator de dados de imóveis. Leia o markdown de uma página de resultados de busca de imóveis. ' +
  'Retorne um JSON object com a chave "listings" contendo um array de imóveis encontrados na página. ' +
  'IMPORTANTE: cada imóvel deve ter o preço EXATO mostrado no card dele — não repita o mesmo preço para imóveis diferentes. ' +
  'Campos por imóvel: listing_url (string — URL completa do anúncio), title (string), ' +
  'price (número BRL sem R$ ou pontos), bedrooms (número), bathrooms (número), ' +
  'area_sqm (número), parking (número), neighborhood (string), city (string), ' +
  'property_type (string), image_url (string — URL da foto do card). ' +
  'Omita campos não encontrados. Responda APENAS com o JSON {"listings":[...]}.';

// ---------------------------------------------------------------------------
// Strategy A: scrape the search-results page with markdown + our LLM.
// Uses markdown+links (simple HTTP, no Playwright) to avoid anti-bot triggers.
// Firecrawl JSON schema format internally uses Playwright and gets blocked.
// ---------------------------------------------------------------------------

async function scrapeSearchPage(
  searchUrl: string,
  domain: string,
  criteria: SearchCriteria,
): Promise<NormalizedListing[]> {
  logger.info('site_scraper_search_page_start', { domain, searchUrl });

  await acquireRateLimit(searchUrl);
  const firecrawl = getFirecrawl();
  const result = await firecrawl.scrape(searchUrl, {
    formats: ['markdown', 'links'],
    onlyMainContent: false,
    timeout: 60000,
  });

  const res = result as Record<string, unknown>;
  const markdown = typeof res.markdown === 'string' ? res.markdown : '';
  const links: string[] = Array.isArray(res.links) ? res.links as string[] : [];

  if (!markdown || markdown.trim().length < 50) {
    logger.warn('site_scraper_search_page_empty', { domain, searchUrl });
    return [];
  }

  const origin = (() => { try { return new URL(searchUrl).origin; } catch { return ''; } })();
  const resolveListingUrl = (href: string) => {
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
    return `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
  };

  // Extract listing URLs from links for cross-referencing with LLM output
  const listingLinks = new Set(
    links
      .map(resolveListingUrl)
      .filter((l) => /\/imovel\/|\/property\/|\/listing\/|\/apartamento\/|\/casa\//.test(l)),
  );

  // Call our LLM to parse the markdown and extract structured listing data
  let raw: Record<string, unknown>[] = [];
  try {
    const resp = await callLLM({
      model: MODELS.listingSync,
      system: SEARCH_PAGE_EXTRACT_PROMPT,
      prompt: markdown.slice(0, 12_000),
      jsonMode: true,
      maxTokens: 4096,
      timeoutMs: 30_000,
    });
    const parsed = JSON.parse(resp.content[0]?.text ?? '{}');
    const items: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>).listings)
        ? (parsed as Record<string, unknown>).listings as unknown[]
        : [];
    raw = items as Record<string, unknown>[];
  } catch (err) {
    logger.warn('site_scraper_search_page_llm_error', { domain, error: String(err) });
  }

  logger.info('site_scraper_search_page_done', {
    domain,
    llmListings: raw.length,
    linkListings: listingLinks.size,
  });

  // Build results from LLM output; if LLM found no URL but we have link-scraped
  // URLs, fall back to using those as stubs (no price/details from links alone).
  const results = raw
    .filter((l) => l.listing_url && l.price)
    .map((l) => toNormalized(
      l,
      searchUrl,
      domain,
      resolveListingUrl(String(l.listing_url)),
      criteria,
    ));

  return results;
}

// System prompt for extracting a single listing from its individual page markdown.
const INDIVIDUAL_PAGE_EXTRACT_PROMPT =
  'Você é um extrator de dados de imóveis. Leia o markdown de uma página de anúncio individual e retorne um JSON com: ' +
  'title (string), price (número BRL sem R$ ou pontos), bedrooms (número), bathrooms (número), ' +
  'area_sqm (número), parking (número), neighborhood (string), city (string), ' +
  'property_type (string), description (string max 200 chars), image_url (string — URL da foto principal). ' +
  'Omita campos não encontrados. Responda APENAS com o JSON.';

// ---------------------------------------------------------------------------
// Shared: scrape N individual listing pages concurrently with LLM extraction.
// Used by firecrawl_links, karioca_api, and markers_extract strategies.
// ---------------------------------------------------------------------------

const LINKS_SCRAPE_CONCURRENCY = 3;
const LINKS_ANTIBOT_LIMIT = 3;

async function scrapeIndividualPages(
  listingUrls: string[],
  domain: string,
  searchUrl: string,
  criteria: SearchCriteria,
): Promise<NormalizedListing[]> {
  const listings: NormalizedListing[] = [];
  const firecrawl = getFirecrawl();
  let consecutiveAntibotErrors = 0;
  let aborted = false;

  for (let i = 0; i < listingUrls.length && !aborted; i += LINKS_SCRAPE_CONCURRENCY) {
    const chunk = listingUrls.slice(i, i + LINKS_SCRAPE_CONCURRENCY);

    const settled = await Promise.allSettled(
      chunk.map(async (url) => {
        await acquireRateLimit(url);
        const res = await firecrawl.scrape(url, {
          formats: ['markdown'],
          onlyMainContent: false,
          timeout: 45000,
        });
        const markdown = (res as Record<string, unknown>).markdown as string | undefined ?? '';
        if (!markdown || markdown.trim().length < 50) return null;

        const resp = await callLLM({
          model: MODELS.listingSync,
          system: INDIVIDUAL_PAGE_EXTRACT_PROMPT,
          prompt: markdown.slice(0, 4000),
          jsonMode: true,
          maxTokens: 1024,
          timeoutMs: 20_000,
        });
        const raw = JSON.parse(resp.content[0]?.text ?? 'null') as Record<string, unknown> | null;
        return raw ? { url, raw } : null;
      }),
    );

    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        const msg = String((outcome as PromiseRejectedResult).reason);
        if (msg.includes('antibot') || msg.includes('anti-bot') || msg.includes('SCRAPE_RETRY_LIMIT')) {
          consecutiveAntibotErrors++;
          if (consecutiveAntibotErrors >= LINKS_ANTIBOT_LIMIT) {
            logger.warn('site_scraper_links_antibot_abort', { domain, skipped: listingUrls.length - i });
            aborted = true;
          }
        } else {
          consecutiveAntibotErrors = 0;
        }
        continue;
      }
      consecutiveAntibotErrors = 0;
      const val = outcome.value;
      if (!val?.raw?.price) continue;
      listings.push(toNormalized(val.raw, searchUrl, domain, val.url, criteria));
    }
  }

  return listings;
}

// ---------------------------------------------------------------------------
// Strategy B: get listing links → scrape individual pages concurrently.
// Used by: karioca (search page markdown extraction is unreliable without JSON-LD).
// batchScrape is NOT available on self-hosted Firecrawl (/v1/batch/scrape → 404).
// Uses markdown (simple HTTP) to avoid Playwright/anti-bot triggers.
// ---------------------------------------------------------------------------

async function scrapeViaLinks(
  searchUrl: string,
  siteOrigin: string,
  domain: string,
  criteria: SearchCriteria,
  maxListings = 20,
): Promise<NormalizedListing[]> {
  logger.info('site_scraper_links_start', { domain, searchUrl });

  const firecrawl = getFirecrawl();

  // Step 1: get all links from search page (markdown+links — simple HTTP, no Playwright)
  const linkResult = await firecrawl.scrape(searchUrl, {
    formats: ['links'],
    onlyMainContent: false,
    timeout: 45000,
  });

  const allLinks: string[] = (linkResult as Record<string, unknown>).links as string[] ?? [];

  const resolveUrl = (href: string): string => {
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
    return `${siteOrigin}${href.startsWith('/') ? '' : '/'}${href}`;
  };

  const listingLinks = [...new Set(
    allLinks
      .filter((l) => typeof l === 'string' && l.includes('/imovel/'))
      .map(resolveUrl),
  )].slice(0, maxListings);

  logger.info('site_scraper_links_found', { domain, total: allLinks.length, listingLinks: listingLinks.length });

  if (listingLinks.length === 0) return [];

  // Step 2: scrape individual pages
  const listings = await scrapeIndividualPages(listingLinks, domain, searchUrl, criteria);

  logger.info('site_scraper_links_done', { domain, count: listings.length });
  return listings;
}

// ---------------------------------------------------------------------------
// Smart strategy C: Karioca /buscar API
//
// Karioca exposes a server-side filtered search API at /buscar that returns
// JSON { view: "<html>", view_mobile: "...", locations: [...] }.
// We call it directly (no Firecrawl credit for the search step), extract
// listing URLs from the HTML, then scrape individual pages.
//
// Neighborhood mapping (from Karioca's DB):
//   Barra Olímpica / Barra Olimpica → 56
//   Recreio dos Bandeirantes / Recreio → 3
//   Vargem Grande → 9
//   Vargem Pequena → 28
//   Barra da Tijuca → 1
//   Jacarepaguá / Freguesia → 114
// ---------------------------------------------------------------------------

const KARIOCA_NEIGHBORHOOD_MAP: Record<string, number> = {
  'barra olimpica': 56,
  'barra olímpica': 56,
  'recreio dos bandeirantes': 3,
  'recreio': 3,
  'vargem grande': 9,
  'vargem pequena': 28,
  'barra da tijuca': 1,
  // Note: 'barra' alone is intentionally omitted — it would false-match
  // "Barra Olímpica" as Barra da Tijuca. Users must specify the full name.
  'jacarepaguá': 114,
  'jacarepagua': 114,
  'freguesia': 114,
  'ipanema': 16,
  'leblon': 17,
  'copacabana': 18,
};

const KARIOCA_PROPERTY_TYPE_MAP: Record<string, number> = {
  apartment: 1,
  apartamento: 1,
  flat: 7,
  studio: 14,
  kitnet: 14,
  penthouse: 6,
  cobertura: 6,
  house: 5,
  casa: 5,
  land: 15,
  terreno: 15,
};

function kariocaNeighborhoodIds(criteria: SearchCriteria): number[] {
  const candidates = [
    ...(criteria.neighborhoods ?? []),
    ...(criteria.neighborhood ? [criteria.neighborhood] : []),
  ];
  const ids = new Set<number>();
  for (const name of candidates) {
    const key = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const [mapKey, id] of Object.entries(KARIOCA_NEIGHBORHOOD_MAP)) {
      const normKey = mapKey.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (key.includes(normKey) || normKey.includes(key)) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

// Parse all listing cards from a Karioca /buscar HTML response.
// Card structure (server-rendered, no JS needed):
//   <div class="flex flex-col">
//     ... href="/imovel/..." aria-label="Title" src="photo.jpg"
//     <p class="text-[16px] font-bold">NEIGHBORHOOD - CITY</p>
//     R$ 750.000,00
//     70 m² (after /metric.svg) | 2 bedrooms (after /bed.svg)
//     | 2 bathrooms (after /bathroom.svg) | 1 parking (after /car.svg)
function parseKariocaCards(
  html: string,
  siteOrigin: string,
  criteria: SearchCriteria,
): NormalizedListing[] {
  const results: NormalizedListing[] = [];
  const seenUrls = new Set<string>();
  const cards = html.split('<div class="flex flex-col">').slice(1);

  for (const card of cards) {
    // URL — first /imovel/ href
    const urlMatch = card.match(/href="(\/imovel\/[^"]+)"/);
    if (!urlMatch) continue;
    const url = `${siteOrigin}${urlMatch[1]}`;
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    // Photo
    const photoMatch = card.match(/src="(https?:\/\/[^"]+\.(?:jpeg|jpg|png|webp)[^"]*)"/i);
    const photo = photoMatch ? photoMatch[1] : null;

    // Title from aria-label
    const titleMatch = card.match(/aria-label="([^"]+?)(?:\}\})?"/);
    const title = titleMatch ? titleMatch[1]!.trim() : '';

    // Neighborhood — inside font-bold paragraph
    const nbMatch = card.match(/<p class="text-\[16px\] font-bold [^"]*">([^<]+)<\/p>/);
    const neighborhoodRaw = nbMatch ? nbMatch[1]!.trim() : '';
    const neighborhoodParts = neighborhoodRaw.split(' - ');
    const neighborhood = neighborhoodParts[0]?.trim() ?? neighborhoodRaw;
    const city = neighborhoodParts[1]?.trim() ?? criteria.city;

    // Price — R$ NNN.NNN,NN
    const priceMatch = card.match(/R\$\s*([\d.]+),\d{2}/);
    const price = priceMatch
      ? parseInt(priceMatch[1]!.replace(/\./g, ''), 10)
      : 0;
    if (price === 0) continue;

    // Area (m²), bedrooms, bathrooms, parking from icon-adjacent paragraphs
    // Note: using [\s\S]*? instead of .*? with /s flag (ES2017 target)
    const metricMatch = card.match(/metric\.svg[^>]*>[\s\S]*?<p[^>]*>([\d,]+)\s*m/);
    const areaSqm = metricMatch ? parseFloat(metricMatch[1]!.replace(',', '.')) : null;

    const bedMatch = card.match(/bed\.svg[^>]*>[\s\S]*?<p[^>]*>(\d+)<\/p>/);
    const bedrooms = bedMatch ? parseInt(bedMatch[1]!, 10) : null;

    const bathMatch = card.match(/bathroom\.svg[^>]*>[\s\S]*?<p[^>]*>(\d+)<\/p>/);
    const bathrooms = bathMatch ? parseInt(bathMatch[1]!, 10) : null;

    const carMatch = card.match(/car\.svg[^>]*>[\s\S]*?<p[^>]*>(\d+)<\/p>/);
    const parking = carMatch ? parseInt(carMatch[1]!, 10) : null;

    results.push({
      source: 'portal_x' as const,
      externalId: url,
      url,
      title,
      description: '',
      photos: photo ? [photo] : [],
      address: '',
      neighborhood,
      city,
      state: criteria.state ?? '',
      propertyType: 'apartment' as const,
      bedrooms,
      bathrooms,
      areaSqm,
      parkingSpots: parking,
      price,
      priceType: criteria.purpose === 'rent' ? 'rent' as const : 'sale' as const,
      furnished: null,
      amenities: [],
      extractedAmenities: {} as Record<string, boolean>,
      geohash7: null,
      lat: null,
      lng: null,
      scrapedAt: new Date().toISOString(),
    });
  }

  return results;
}

async function scrapeKariocaApi(
  siteOrigin: string,
  domain: string,
  criteria: SearchCriteria,
  maxListings = 20,
): Promise<NormalizedListing[]> {
  const neighborhoodIds = kariocaNeighborhoodIds(criteria);
  const finalityId = criteria.purpose === 'rent' ? 2 : 1;
  const propertyTypeKey = criteria.propertyType?.toLowerCase() ?? 'apartment';
  const propertyTypeId = KARIOCA_PROPERTY_TYPE_MAP[propertyTypeKey] ?? 1;
  const bedroomsMin = criteria.bedroomsMin ?? '';
  const valueTo = criteria.priceMax ?? '';
  const valueFrom = criteria.priceMin ?? '';

  logger.info('site_scraper_karioca_api_start', {
    domain,
    neighborhoodIds,
    finalityId,
    propertyTypeId,
    bedroomsMin,
    valueTo,
  });

  // If no neighborhoods specified, search without neighborhood filter
  const searchIds = neighborhoodIds.length > 0 ? neighborhoodIds : [0];

  // Collect ALL matching listings from the API across all neighborhoods and pages.
  // The API pre-filters by type, bedrooms, price, and neighborhood — so the
  // total is always small (tens). Each card HTML already has full listing data
  // (price, bedrooms, area, parking, neighborhood, photo) — no individual page
  // scraping needed, saving all Firecrawl credits for this strategy.
  const seenUrls = new Set<string>();
  const allListings: NormalizedListing[] = [];
  const MAX_PAGES_PER_NEIGHBORHOOD = 10;

  for (const neighborhoodId of searchIds) {
    let page = 1;
    while (page <= MAX_PAGES_PER_NEIGHBORHOOD) {
      const params = new URLSearchParams({
        finality_id: String(finalityId),
        propertytype_id: String(propertyTypeId),
        ...(neighborhoodId > 0 ? { neighborhood_id: String(neighborhoodId) } : {}),
        ...(bedroomsMin !== '' ? { bedroom: String(bedroomsMin) } : {}),
        ...(valueTo !== '' ? { value_to: String(valueTo) } : {}),
        ...(valueFrom !== '' ? { value_from: String(valueFrom) } : {}),
        search: '1',
        list: '1',
        page: String(page),
      });

      const apiUrl = `${siteOrigin}/buscar?${params.toString()}`;

      const res = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/javascript, */*',
        },
      });

      if (!res.ok) {
        logger.warn('site_scraper_karioca_api_error', { domain, status: res.status, page });
        break;
      }

      const json = await res.json() as { view?: string };
      const html = json.view ?? '';

      if (!html || html.trim().length < 100) break;

      const pageListings = parseKariocaCards(html, siteOrigin, criteria);
      if (pageListings.length === 0) break;

      for (const listing of pageListings) {
        if (!seenUrls.has(listing.url)) {
          seenUrls.add(listing.url);
          allListings.push(listing);
        }
      }

      if (!html.includes('seemore')) break;
      page++;
    }
  }

  logger.info('site_scraper_karioca_api_done', {
    domain,
    total: allListings.length,
    returned: Math.min(allListings.length, maxListings),
  });

  return allListings.slice(0, maxListings);
}

// ---------------------------------------------------------------------------
// Smart strategy D: Markers JS extraction (Family Brokers / WordPress)
//
// Some WordPress sites embed all property data as a JS `markers` array in the
// page HTML (used to populate a map). Each marker has: lat, lng, title, url,
// bairro, valor. We extract this array, filter by criteria, then scrape only
// the matching individual pages — avoiding hundreds of unnecessary scrapes.
// ---------------------------------------------------------------------------

interface MarkerEntry {
  lat?: number;
  lng?: number;
  title?: string;
  url?: string;
  bairro?: string;
  valor?: number;
  valor_formatado?: string;
}

function norm(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function markerMatchesCriteria(marker: MarkerEntry, criteria: SearchCriteria): boolean {
  // Price: hard exclude > 120% of priceMax
  if (criteria.priceMax != null && (marker.valor ?? 0) > criteria.priceMax * 1.2) return false;
  if (criteria.priceMin != null && (marker.valor ?? 0) > 0 && (marker.valor ?? 0) < criteria.priceMin) return false;

  // Neighborhood match (loose — bairro field or title)
  const hasNeighborhood =
    (criteria.neighborhoods?.length ?? 0) > 0 || criteria.neighborhood != null;
  if (hasNeighborhood) {
    const candidates = [
      ...(criteria.neighborhoods ?? []),
      ...(criteria.neighborhood ? [criteria.neighborhood] : []),
    ];
    const haystack = norm(marker.bairro ?? '') + ' ' + norm(marker.title ?? '');
    const matches = candidates.some((n) => {
      const needle = norm(n);
      return haystack.includes(needle) || needle.includes(norm(marker.bairro ?? ''));
    });
    if (!matches) return false;
  }

  return true;
}

function extractBedroomsFromTitle(title: string): number | null {
  const m = title.match(/(\d+)\s*quarto/i);
  return m ? parseInt(m[1]!, 10) : null;
}

async function scrapeMarkersExtract(
  searchUrl: string,
  siteOrigin: string,
  domain: string,
  criteria: SearchCriteria,
  maxListings = 20,
): Promise<NormalizedListing[]> {
  logger.info('site_scraper_markers_start', { domain, searchUrl });

  // Step 1: fetch the page HTML to extract the markers array
  const res = await fetch(searchUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });

  if (!res.ok) {
    logger.warn('site_scraper_markers_fetch_error', { domain, status: res.status });
    return [];
  }

  const html = await res.text();

  // Extract the markers array from inline JS
  const markersStart = html.indexOf('let markers = [');
  if (markersStart < 0) {
    logger.warn('site_scraper_markers_not_found', { domain });
    return [];
  }

  const arrayStart = markersStart + 'let markers = '.length;
  let depth = 0;
  let inStr = false;
  let escape = false;
  let arrayEnd = arrayStart;

  for (let i = arrayStart; i < html.length; i++) {
    const c = html[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"' && !escape) { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) { arrayEnd = i + 1; break; }
    }
  }

  let markers: MarkerEntry[] = [];
  try {
    markers = JSON.parse(html.slice(arrayStart, arrayEnd)) as MarkerEntry[];
  } catch (err) {
    logger.warn('site_scraper_markers_parse_error', { domain, error: String(err) });
    return [];
  }

  logger.info('site_scraper_markers_extracted', { domain, total: markers.length });

  // Step 2: filter markers by criteria
  const filtered = markers
    .filter((m) => m.url && (m.valor ?? 0) > 0)
    .filter((m) => markerMatchesCriteria(m, criteria));

  // Pre-filter by bedrooms from title (best-effort — avoids unnecessary scrapes)
  const bedroomsFiltered = criteria.bedroomsMin != null
    ? filtered.filter((m) => {
        const titleBedrooms = extractBedroomsFromTitle(m.title ?? '');
        // If we can't parse bedrooms from title, include it (will be confirmed on individual page)
        return titleBedrooms == null || titleBedrooms >= (criteria.bedroomsMin ?? 0);
      })
    : filtered;

  logger.info('site_scraper_markers_filtered', {
    domain,
    afterPriceNeighborhood: filtered.length,
    afterBedroomsPrefilter: bedroomsFiltered.length,
  });

  if (bedroomsFiltered.length === 0) return [];

  // Step 3: resolve full URLs
  const resolveUrl = (href: string) => {
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
    return `${siteOrigin}${href.startsWith('/') ? '' : '/'}${href}`;
  };

  // Cap individual Firecrawl scrapes — each call takes ~3-4s; 25 pages ≈ 90s max
  const MAX_MARKER_SCRAPES = 25;
  const listingUrls = bedroomsFiltered
    .slice(0, Math.min(maxListings, MAX_MARKER_SCRAPES))
    .map((m) => resolveUrl(m.url!));

  logger.info('site_scraper_markers_scraping', { domain, count: listingUrls.length });

  // Step 4: scrape individual pages
  const listings = await scrapeIndividualPages(listingUrls, domain, searchUrl, criteria);

  logger.info('site_scraper_markers_done', { domain, count: listings.length });
  return listings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type SiteScraperStrategy = 'firecrawl_json' | 'firecrawl_links';

export interface SiteScraperConfig {
  domain: string;
  baseUrl: string;
  strategy: SiteScraperStrategy;
  /** Configured seed URLs from PartnerSite.seedUrls — used instead of hardcoded paths */
  seedUrls?: string[];
  /** Max listings to return (default 20) */
  maxListings?: number;
  /** Site-specific search config from PartnerSite.searchConfig */
  searchConfig?: Record<string, unknown> | null;
}

/**
 * Scrape a partner real estate site and return normalised listings.
 *
 * Routing priority:
 *   1. searchConfig.type === 'karioca_api'    → direct /buscar API call
 *   2. searchConfig.type === 'markers_extract' → JS markers array extraction
 *   3. strategy === 'firecrawl_json'           → markdown scrape + LLM
 *   4. strategy === 'firecrawl_links'          → links + individual page scrape
 *
 * Search URL priority (for strategies 3 & 4):
 *   1. Site-specific seedUrl matching the purpose (rent/sale) from config.seedUrls
 *   2. First seedUrl (if only one configured)
 *   3. Fallback to generic /imoveis/a-venda or /imoveis/aluguel appended to baseUrl
 */
export async function scrapeSite(
  config: SiteScraperConfig,
  criteria: SearchCriteria,
): Promise<NormalizedListing[]> {
  const { domain, baseUrl, strategy, seedUrls = [], maxListings = 20, searchConfig } = config;

  const siteOrigin = (() => { try { return new URL(baseUrl).origin; } catch { return baseUrl; } })();

  // Smart search strategies — bypass the standard Firecrawl flow
  if (searchConfig?.type === 'karioca_api') {
    return await scrapeKariocaApi(siteOrigin, domain, criteria, maxListings);
  }

  if (searchConfig?.type === 'markers_extract') {
    // Use the matching seed URL (rent vs sale) or fall back to first seed
    const isRent = criteria.purpose === 'rent';
    const rentHint = /aluguel|alugar|locacao|locaç/i;
    const saleHint = /venda|compra|a-venda|prontos/i;
    const markersUrl = seedUrls.length > 0
      ? (seedUrls.find((u) => isRent ? rentHint.test(u) : saleHint.test(u)) ?? seedUrls[0]!)
      : (isRent ? `${siteOrigin}/aluguel/` : `${siteOrigin}/prontos/`);

    return await scrapeMarkersExtract(markersUrl, siteOrigin, domain, criteria, maxListings);
  }

  // Standard Firecrawl strategies — pick the best seed URL
  const isRent = criteria.purpose === 'rent';
  const rentHint = /aluguel|alugar|locacao|locaç/i;
  const saleHint = /venda|compra|a-venda/i;

  let searchUrl: string;
  if (seedUrls.length > 0) {
    const matched =
      seedUrls.find((u) => isRent ? rentHint.test(u) : saleHint.test(u)) ??
      seedUrls[0]!;
    searchUrl = matched;
  } else {
    const fallbackPath = isRent ? '/imoveis/aluguel' : '/imoveis/a-venda';
    searchUrl = baseUrl.replace(/\/+$/, '') + fallbackPath;
    logger.warn('site_scraper_no_seed_urls', { domain, fallbackUrl: searchUrl });
  }

  try {
    if (strategy === 'firecrawl_json') {
      return await scrapeSearchPage(searchUrl, domain, criteria);
    }
    return await scrapeViaLinks(searchUrl, siteOrigin, domain, criteria, maxListings);
  } catch (err) {
    logger.warn('site_scraper_error', { domain, strategy, error: String(err) });
    return [];
  }
}
