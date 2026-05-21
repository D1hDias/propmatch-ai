import 'server-only';
import FirecrawlApp from '@mendable/firecrawl-js';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';
import { callLLM } from '@/server/lib/llm';
import { MODELS } from '@/server/lib/models';
import type { PartnerSite } from '@prisma/client';
import type { NormalizedListing, SearchCriteria } from '@/server/search/types';

// ---------------------------------------------------------------------------
// DATA-8: Partner site inventory sync.
//
// assessSite()  — runs Firecrawl MAP to discover all listing URLs on a site.
//                 Cheap: ~1 credit per 1000 URLs discovered.
//
// syncSite()    — delta sync against the DB:
//                   1. assessSite() → current URL set
//                   2. Compare with known URLs in property_sources
//                   3. batchScrape new URLs → upsert Property + PropertySource_
//                   4. Mark removed URLs → property.active = false
// ---------------------------------------------------------------------------

let _firecrawl: FirecrawlApp | null = null;

function getFirecrawl(): FirecrawlApp {
  if (!_firecrawl) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set');
    _firecrawl = new FirecrawlApp({ apiKey, apiUrl: process.env.FIRECRAWL_API_URL });
  }
  return _firecrawl;
}

// System prompt for single-listing extraction (individual page).
const EXTRACTION_SYSTEM_PROMPT =
  'Você é um extrator de dados de imóveis. Leia o texto de uma página de anúncio e retorne um JSON com os campos: ' +
  'title (string), price (número BRL sem R$ ou pontos), bedrooms (número), bathrooms (número), ' +
  'area_sqm (número), parking (número), neighborhood (string), city (string), ' +
  'property_type (string), description (string max 200 chars), address (string), ' +
  'image_url (string — URL da foto principal do imóvel; procure em og:image, a primeira imagem grande da galeria, ou qualquer <img> com foto do imóvel). ' +
  'Omita campos não encontrados. Responda APENAS com o JSON, sem texto adicional.';

// JSON schema sent to Firecrawl for structured extraction from a search-results page.
// Firecrawl's internal LLM is more accurate than calling our LLM on raw markdown.
const SEED_PAGE_SCHEMA = {
  type: 'object',
  properties: {
    listings: {
      type: 'array',
      description: 'All property listings found on this search results page',
      items: {
        type: 'object',
        properties: {
          title:         { type: 'string', description: 'Property title' },
          price:         { type: 'number', description: 'Sale or rent price in BRL (number only, no R$)' },
          bedrooms:      { type: 'number', description: 'Number of bedrooms (quartos)' },
          bathrooms:     { type: 'number', description: 'Number of bathrooms (banheiros)' },
          area_sqm:      { type: 'number', description: 'Total area in m² (number only)' },
          parking:       { type: 'number', description: 'Number of parking spots (vagas)' },
          neighborhood:  { type: 'string', description: 'Neighborhood name (bairro)' },
          city:          { type: 'string', description: 'City name' },
          property_type: { type: 'string', description: 'Type: apartment, house, studio, penthouse, commercial, land' },
          listing_url:   { type: 'string', description: 'Full direct URL to this specific listing page' },
          image_url:     { type: 'string', description: 'URL of the main listing photo' },
        },
        required: ['title', 'price', 'listing_url'],
      },
    },
  },
  required: ['listings'],
};

// System prompt for bulk extraction from a listing INDEX page via our LLM.
const BULK_EXTRACTION_SYSTEM_PROMPT =
  'Você é um extrator de dados de imóveis. Leia o markdown de uma página de lista de imóveis. ' +
  'Retorne um JSON object com a chave "listings" contendo um array de imóveis. ' +
  'IMPORTANTE: cada imóvel deve ter o preço EXATO mostrado no card dele — não repita o mesmo preço para imóveis diferentes. ' +
  'Campos por imóvel: url (string — URL completa), title (string), price (número BRL sem R$ ou pontos), ' +
  'bedrooms (número), bathrooms (número), area_sqm (número), parking (número), ' +
  'neighborhood (string), city (string), property_type (string), ' +
  'image_url (string — URL da foto do card). ' +
  'Omita campos não encontrados. Responda APENAS com o JSON object {"listings":[...]}.';

// Max listing URLs per batchScrape call (Firecrawl recommendation: ≤25)
const BATCH_SIZE = 25;

// Default URL path fragments that identify individual listing pages
const DEFAULT_LISTING_PATTERNS = ['/imovel/', '/imoveis/', '/property/', '/listing/', '/apartamento/', '/casa/'];

// ---------------------------------------------------------------------------
// assessSite — discover listing URLs via Firecrawl MAP
// ---------------------------------------------------------------------------

export async function assessSite(site: PartnerSite): Promise<{ listingUrls: string[] }> {
  logger.info('site_assess_start', { domain: site.domain });

  const firecrawl = getFirecrawl();
  const patterns = site.propertyUrlPatterns.length > 0
    ? site.propertyUrlPatterns
    : DEFAULT_LISTING_PATTERNS;

  // Step 1: MAP — sitemap-based discovery (cheap, ~1 credit per 1000 URLs)
  let mapUrls: string[] = [];
  try {
    const mapResult = await firecrawl.map(site.baseUrl, { limit: 5000 });
    const allLinks: string[] = (mapResult.links ?? []).map((entry) =>
      typeof entry === 'string' ? entry : entry.url,
    );
    mapUrls = [...new Set(
      allLinks.filter((url) => typeof url === 'string' && patterns.some((p) => url.includes(p))),
    )];
    logger.info('site_assess_map_done', { domain: site.domain, mapUrls: mapUrls.length });
  } catch (err) {
    logger.warn('site_assess_map_failed', { domain: site.domain, error: String(err) });
  }

  // Step 2: seedUrls — scrape listing index pages to find URLs not in sitemap
  // (e.g. sites that add listings without updating their sitemap)
  const seedListings = await discoverFromSeedUrls(site, patterns);
  const seedUrlStrings = seedListings.map((s) => s.url);

  const listingUrls = [...new Set([...mapUrls, ...seedUrlStrings])];

  if (listingUrls.length === 0 && site.needsJavascript) {
    logger.warn('site_assess_needs_playwright', {
      domain: site.domain,
      hint: 'Site requires JavaScript rendering. Set needsJavascript=true and configure a Playwright worker.',
    });
  }

  logger.info('site_assess_done', {
    domain: site.domain,
    mapUrls: mapUrls.length,
    seedUrls: seedUrlStrings.length,
    total: listingUrls.length,
  });

  // Persist count non-critically
  prisma.partnerSite
    .update({ where: { id: site.id }, data: { listingCount: listingUrls.length } })
    .catch(() => {});

  return { listingUrls };
}

// ---------------------------------------------------------------------------
// discoverFromSeedUrls — scrape listing index pages, collect URLs + data
//
// Uses Firecrawl `formats: ['markdown','links']` to get both hrefs and page
// content in one credit, then calls the LLM bulk extractor to get structured
// data for all listing cards on the page.
//
// Returning pre-extracted data avoids scraping individual listing pages
// (saves ~1 credit per listing × hundreds of listings).
// ---------------------------------------------------------------------------

interface SeedListing {
  url: string;
  rawData: Record<string, unknown>;
}

async function discoverFromSeedUrls(
  site: PartnerSite,
  listingPatterns: string[],
): Promise<SeedListing[]> {
  if (site.seedUrls.length === 0) return [];

  const firecrawl = getFirecrawl();
  const discovered = new Map<string, SeedListing>();
  const MAX_PAGES_PER_SEED = 20;
  const siteOrigin = (() => { try { return new URL(site.baseUrl).origin; } catch { return site.baseUrl; } })();

  for (const seedUrl of site.seedUrls) {
    let page = 1;
    let emptyPages = 0;

    // Propagate price type from seed URL context (aluguel vs venda)
    const seedPriceType = /aluguel|alugar|a-alugar|locacao|loca[çc]ao/i.test(seedUrl)
      ? 'rent' : 'sale';

    while (page <= MAX_PAGES_PER_SEED && emptyPages < 2) {
      const pageUrl = buildPaginatedUrl(seedUrl, page);
      try {
        // Use markdown+links (simple HTTP fetch) — avoids anti-bot triggers that
        // Playwright-based formats (json schema) cause on some sites.
        const result = await firecrawl.scrape(pageUrl, {
          formats: ['markdown', 'links'],
          onlyMainContent: false,
          timeout: 60000,
        });

        const res = result as Record<string, unknown>;
        const links: string[] = Array.isArray(res.links) ? res.links as string[] : [];
        const markdown: string = typeof res.markdown === 'string' ? res.markdown : '';

        const useHeuristic = site.propertyUrlPatterns.length === 0;
        const listingLinks = links
          .map((l) => (l.startsWith('/') ? `${siteOrigin}${l}` : l))
          .filter((l) => {
            if (!l.startsWith(siteOrigin)) return false;
            if (useHeuristic) {
              // No configured patterns: keep same-domain paths that look like content
              // pages (not navigation). Handles WordPress-style root-level slugs.
              try {
                const path = new URL(l).pathname;
                if (/^\/(blog|contato|sobre|equipe|servicos|politica|termos|privacidade|wp-|feed|sitemap|page|pagina|tag|categoria|author)\/?/i.test(path)) return false;
                if (path === '/') return false;
                const segments = path.split('/').filter(Boolean);
                // Multi-segment path (e.g. /imovel/slug/) or long root slug (4+ words)
                if (segments.length >= 2) return true;
                if (segments.length === 1 && (segments[0] ?? '').split('-').length >= 4) return true;
                return false;
              } catch { return false; }
            }
            return listingPatterns.some((p) => l.includes(p));
          });

        const newLinks = listingLinks.filter((l) => !discovered.has(canonicalListingUrl(l)));

        if (newLinks.length === 0) {
          emptyPages++;
          page++;
          continue;
        }

        emptyPages = 0;

        const extracted = await extractBulkFromMarkdown(markdown, site.baseUrl);
        const extractedByUrl = new Map(
          extracted.map((e) => [normaliseUrl(String(e.url ?? '')), e]),
        );

        for (const url of newLinks) {
          const canonical = canonicalListingUrl(url);
          const match = extractedByUrl.get(normaliseUrl(url)) ?? extractedByUrl.get(normaliseUrl(canonical));
          discovered.set(canonical, {
            url: canonical,
            rawData: { ...(match ?? {}), _priceType: seedPriceType },
          });
        }

        logger.info('seed_url_page_scraped', {
          domain: site.domain,
          seedUrl: pageUrl,
          links: listingLinks.length,
          new: newLinks.length,
          extracted: extracted.length,
          total: discovered.size,
        });
      } catch (err) {
        logger.warn('seed_url_scrape_failed', { domain: site.domain, seedUrl: pageUrl, error: String(err) });
        break;
      }
      page++;
    }
  }

  return [...discovered.values()];
}

function normaliseUrl(url: string): string {
  try { return new URL(url).href.replace(/\/$/, ''); } catch { return url.replace(/\/$/, ''); }
}

function buildPaginatedUrl(url: string, page: number): string {
  if (page === 1) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('page', String(page));
    return u.toString();
  } catch {
    return url + (url.includes('?') ? '&' : '?') + 'page=' + page;
  }
}

// ---------------------------------------------------------------------------
// syncSite — delta sync: scrape new, deactivate removed
// ---------------------------------------------------------------------------

export interface SyncResult {
  added: number;
  removed: number;
  errors: number;
  durationMs: number;
}

export interface SyncProgressEvent {
  phase: string;
  page?: number;
  fetched: number;
  added: number;
  total?: number;
}

export async function syncSite(site: PartnerSite, onProgress?: (e: SyncProgressEvent) => void): Promise<SyncResult> {
  // Circuit-breaker: skip sites with too many consecutive failures
  if (site.consecutiveFailures >= 5) {
    logger.warn('site_sync_circuit_open', { domain: site.domain });
    return { added: 0, removed: 0, errors: 0, durationMs: 0 };
  }

  const strategy = site.discoveryStrategy ?? 'map_then_scrape';

  // wp_rest_api:{cpt} — WordPress REST API, full data available (no Firecrawl)
  // wp_rest_api (legacy, no CPT suffix) — defaults to 'estate' for Invexo compat
  const wpRestMatch = strategy.match(/^wp_rest_api:(.+)$/);
  if (strategy === 'wp_rest_api' || wpRestMatch) {
    const cpt = wpRestMatch ? wpRestMatch[1]! : 'estate';
    await prisma.partnerSite.update({ where: { id: site.id }, data: { syncStatus: 'running' } });
    try {
      return await syncSiteViaWpApi(site, cpt, onProgress);
    } catch (err) {
      prisma.partnerSite.update({
        where: { id: site.id },
        data: { syncStatus: 'error', lastErrorAt: new Date(), consecutiveFailures: { increment: 1 } },
      }).catch(() => {});
      throw err;
    }
  }

  // sitemidas_api — Sitemidas/MidasCRM Angular SPA internal JSON API
  if (strategy === 'sitemidas_api') {
    await prisma.partnerSite.update({ where: { id: site.id }, data: { syncStatus: 'running' } });
    try {
      return await syncSiteViaSiteMidasApi(site, onProgress);
    } catch (err) {
      prisma.partnerSite.update({
        where: { id: site.id },
        data: { syncStatus: 'error', lastErrorAt: new Date(), consecutiveFailures: { increment: 1 } },
      }).catch(() => {});
      throw err;
    }
  }

  // kenlo_api — Kenlo (ex-Imobzi) hosted sites: GET /api/listings?page=N
  if (strategy === 'kenlo_api') {
    await prisma.partnerSite.update({ where: { id: site.id }, data: { syncStatus: 'running' } });
    try {
      return await syncSiteViaKenloApi(site, onProgress);
    } catch (err) {
      prisma.partnerSite.update({
        where: { id: site.id },
        data: { syncStatus: 'error', lastErrorAt: new Date(), consecutiveFailures: { increment: 1 } },
      }).catch(() => {});
      throw err;
    }
  }

  // karioca_buscar — custom platform: GET /buscar?finality_id=N&list=1&page=N (HTML)
  if (strategy === 'karioca_buscar') {
    await prisma.partnerSite.update({ where: { id: site.id }, data: { syncStatus: 'running' } });
    try {
      return await syncSiteViaKarocaBuscar(site, onProgress);
    } catch (err) {
      prisma.partnerSite.update({
        where: { id: site.id },
        data: { syncStatus: 'error', lastErrorAt: new Date(), consecutiveFailures: { increment: 1 } },
      }).catch(() => {});
      throw err;
    }
  }

  // wp_url_scrape:{cpt} — WP REST API for URLs, Firecrawl for page content
  const wpUrlMatch = strategy.match(/^wp_url_scrape:(.+)$/);
  if (wpUrlMatch) {
    const cpt = wpUrlMatch[1]!;
    await prisma.partnerSite.update({ where: { id: site.id }, data: { syncStatus: 'running' } });
    try {
      return await syncSiteViaWpUrlScrape(site, cpt);
    } catch (err) {
      prisma.partnerSite.update({
        where: { id: site.id },
        data: { syncStatus: 'error', lastErrorAt: new Date(), consecutiveFailures: { increment: 1 } },
      }).catch(() => {});
      throw err;
    }
  }

  await prisma.partnerSite.update({ where: { id: site.id }, data: { syncStatus: 'running' } });

  const start = Date.now();
  let added = 0;
  let removed = 0;
  let errors = 0;

  try {
    const patterns = site.propertyUrlPatterns.length > 0
      ? site.propertyUrlPatterns
      : DEFAULT_LISTING_PATTERNS;

    // Step 1a: MAP — cheap sitemap discovery
    let mapUrls: string[] = [];
    try {
      const firecrawl = getFirecrawl();
      const mapResult = await firecrawl.map(site.baseUrl, { limit: 5000, includeSubdomains: true });
      const allLinks: string[] = (mapResult.links ?? []).map((e) =>
        typeof e === 'string' ? e : e.url,
      );
      mapUrls = [...new Set(
        allLinks.filter((u) => typeof u === 'string' && patterns.some((p) => u.includes(p))),
      )];
    } catch (err) {
      logger.warn('site_sync_map_failed', { domain: site.domain, error: String(err) });
    }

    // Step 1b: seedUrls — scrape index pages, get URLs + pre-extracted data.
    // This avoids individual listing page scrapes (saves credits at scale).
    const seedListings = await discoverFromSeedUrls(site, patterns);
    const seedByUrl = new Map(seedListings.map((s) => [s.url, s.rawData]));

    const allUrls = [...new Set([...mapUrls, ...seedListings.map((s) => s.url)])];

    if (allUrls.length === 0) {
      logger.warn('site_sync_no_listings', { domain: site.domain });
      await prisma.partnerSite.update({
        where: { id: site.id },
        data: { syncStatus: 'done', lastScrapedAt: new Date() },
      });
      return { added: 0, removed: 0, errors: 0, durationMs: Date.now() - start };
    }

    // Step 2: Load known URLs
    const knownSources = await prisma.propertySource_.findMany({
      where: { partnerSiteId: site.id },
      select: { url: true, propertyId: true },
    });
    const knownUrlSet = new Set(knownSources.map((s) => s.url));
    const currentUrlSet = new Set(allUrls);

    // Step 3: Delta
    const newUrls = allUrls.filter((url) => !knownUrlSet.has(url));
    const removedUrls = [...knownUrlSet].filter((url) => !currentUrlSet.has(url));

    logger.info('site_sync_delta', {
      domain: site.domain,
      total: allUrls.length,
      new: newUrls.length,
      removed: removedUrls.length,
      fromSeed: seedListings.length,
      fromMapOnly: mapUrls.filter((u) => !seedByUrl.has(u)).length,
    });

    // Step 4: Mark removed inactive
    if (removedUrls.length > 0) {
      const removedSources = knownSources.filter((s) => removedUrls.includes(s.url));
      const propertyIds = [...new Set(removedSources.map((s) => s.propertyId))];
      await prisma.property.updateMany({
        where: { id: { in: propertyIds } },
        data: { active: false },
      });
      removed = propertyIds.length;
    }

    // Step 5a: Seed-only fallback — URLs found exclusively on index pages (not in
    // the sitemap). Bulk LLM extraction is less accurate but costs no extra credits.
    // Any URL the MAP also found goes to step 5b for individual scraping instead.
    const mapUrlSet = new Set(mapUrls.map((u) => canonicalListingUrl(u)));
    const seedOnlyNewUrls = newUrls.filter(
      (url) => seedByUrl.has(url) && !mapUrlSet.has(canonicalListingUrl(url)),
    );
    for (const url of seedOnlyNewUrls) {
      const raw = seedByUrl.get(url)!;
      if (!raw.price || !raw.title) { errors++; continue; }
      try {
        await upsertListing(raw, url, site);
        added++;
      } catch (err) {
        logger.warn('site_sync_upsert_error', { url, error: String(err) });
        errors++;
      }
    }

    // Step 5b: Individually scrape MAP-discovered new listings not covered by seed data.
    // Circuit-breaker: if 3 consecutive anti-bot errors occur, the site blocks individual
    // page scraping — abort early to prevent crashing the Firecrawl container.
    const mapNewUrls = newUrls.filter(
      (url) => mapUrlSet.has(canonicalListingUrl(url)) || !seedByUrl.has(url),
    );
    const firecrawl = getFirecrawl();

    const SCRAPE_CONCURRENCY = 3;
    const ANTIBOT_LIMIT = 3;
    let consecutiveAntibotErrors = 0;
    let aborted = false;

    for (let i = 0; i < mapNewUrls.length && !aborted; i += SCRAPE_CONCURRENCY) {
      const chunk = mapNewUrls.slice(i, i + SCRAPE_CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (url) => {
          const result = await firecrawl.scrape(url, {
            formats: ['markdown'],
            onlyMainContent: false,
            timeout: 45000,
          });
          const markdown = (result as Record<string, unknown>).markdown as string | undefined ?? '';
          const raw = await extractFromMarkdown(markdown, url);
          return { url, raw };
        }),
      );

      for (const outcome of settled) {
        if (outcome.status === 'rejected') {
          const msg = String((outcome as PromiseRejectedResult).reason);
          if (msg.includes('antibot') || msg.includes('anti-bot') || msg.includes('SCRAPE_RETRY_LIMIT')) {
            consecutiveAntibotErrors++;
            if (consecutiveAntibotErrors >= ANTIBOT_LIMIT) {
              logger.warn('site_sync_antibot_abort', {
                domain: site.domain,
                skipped: mapNewUrls.length - i,
              });
              aborted = true;
            }
          } else {
            consecutiveAntibotErrors = 0;
          }
          errors++;
          continue;
        }
        consecutiveAntibotErrors = 0;
        const { url, raw } = outcome.value;
        if (!raw?.price || !raw?.title) { errors++; continue; }
        try {
          await upsertListing(raw, url, site);
          added++;
        } catch (err) {
          logger.warn('site_sync_upsert_error', { url, error: String(err) });
          errors++;
        }
      }

      logger.info('site_sync_scrape_progress', {
        domain: site.domain,
        done: Math.min(i + SCRAPE_CONCURRENCY, mapNewUrls.length),
        total: mapNewUrls.length,
        added,
      });
    }

    // Step 6: Update site stats
    await prisma.partnerSite.update({
      where: { id: site.id },
      data: {
        syncStatus: 'done',
        lastScrapedAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        listingCount: allUrls.length,
      },
    });

    const durationMs = Date.now() - start;
    logger.info('site_sync_complete', { domain: site.domain, added, removed, errors, durationMs });
    return { added, removed, errors, durationMs };

  } catch (err) {
    logger.warn('site_sync_failed', { domain: site.domain, error: String(err) });

    prisma.partnerSite
      .update({
        where: { id: site.id },
        data: {
          syncStatus: 'error',
          lastErrorAt: new Date(),
          consecutiveFailures: { increment: 1 },
        },
      })
      .catch(() => {});

    throw err;
  }
}

// ---------------------------------------------------------------------------
// extractFromMarkdown — parse listing fields from page markdown via OpenRouter
// Firecrawl provides raw markdown (1 credit); OpenRouter extracts structure.
// ---------------------------------------------------------------------------

async function extractFromMarkdown(
  markdown: string,
  url: string,
): Promise<Record<string, unknown> | null> {
  if (!markdown || markdown.trim().length < 50) return null;

  try {
    const resp = await callLLM({
      model: MODELS.listingSync,
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt: markdown.slice(0, 4000),
      jsonMode: true,
      maxTokens: 1024,
      timeoutMs: 20_000,
    });

    return JSON.parse(resp.content[0]?.text ?? 'null');
  } catch (err) {
    logger.warn('site_sync_extract_error', { url, error: String(err) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// extractBulkFromMarkdown — extract ALL listings from an index page.
// Index pages can be 100KB+, so we split into 8K-char chunks and call LLM in
// parallel (max 5 concurrent). One LLM call per chunk replaces N Firecrawl
// individual scrapes — much cheaper at scale.
// ---------------------------------------------------------------------------

const BULK_CHUNK_SIZE = 8_000;
const BULK_CONCURRENCY = 5;

async function extractBulkFromMarkdown(
  markdown: string,
  baseUrl: string,
): Promise<Record<string, unknown>[]> {
  if (!markdown || markdown.trim().length < 50) return [];

  // Split markdown into overlapping chunks so listing data at chunk boundaries
  // isn't missed. Overlap of 500 chars ensures we don't cut a listing in half.
  const OVERLAP = 500;
  const chunks: string[] = [];
  for (let i = 0; i < markdown.length; i += BULK_CHUNK_SIZE - OVERLAP) {
    chunks.push(markdown.slice(i, i + BULK_CHUNK_SIZE));
    if (i + BULK_CHUNK_SIZE >= markdown.length) break;
  }

  const results: Record<string, unknown>[] = [];
  const seenUrls = new Set<string>();

  // Process chunks in batches of BULK_CONCURRENCY to avoid rate limits
  for (let i = 0; i < chunks.length; i += BULK_CONCURRENCY) {
    const batch = chunks.slice(i, i + BULK_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((chunk) =>
        callLLM({
          model: MODELS.listingSync,
          system: BULK_EXTRACTION_SYSTEM_PROMPT,
          prompt: chunk,
          jsonMode: true,
          maxTokens: 4096,
          timeoutMs: 30_000,
        }),
      ),
    );

    for (const result of settled) {
      if (result.status === 'rejected') continue;
      try {
        const parsed = JSON.parse(result.value.content[0]?.text ?? '{}');
        // Accept {"listings":[...]} (json_object mode) or bare array
        const items: unknown[] = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as Record<string, unknown>).listings)
            ? (parsed as Record<string, unknown>).listings as unknown[]
            : [];
        for (const item of items as Record<string, unknown>[]) {
          const rawUrl = typeof item.url === 'string' ? item.url : '';
          const absUrl = rawUrl.startsWith('/')
            ? new URL(rawUrl, baseUrl).href
            : rawUrl;
          if (!absUrl || seenUrls.has(absUrl)) continue;
          seenUrls.add(absUrl);
          results.push({ ...item, url: absUrl });
        }
      } catch {
        // Malformed JSON from LLM — skip chunk
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// upsertListing — write one scraped listing into properties + property_sources
// ---------------------------------------------------------------------------

const RENT_SIGNALS_RE = /locaç|locacao|aluguel|para\s+alugar|para\s+locaç|temporada/i;

function inferPriceType(raw: Record<string, unknown>, url: string): 'sale' | 'rent' {
  // Title/description signals are strongest — a listing titled "para locação" is rent
  // regardless of which seed URL it was discovered under.
  const text = `${raw.title ?? ''} ${raw.description ?? ''}`;
  if (RENT_SIGNALS_RE.test(text)) return 'rent';
  // URL path segment is also reliable
  if (/\/aluguel\/|\/alugar\/|\/para-alugar\//.test(url)) return 'rent';
  // Fall back to the seed URL context set by discoverFromSeedUrls
  if (raw._priceType === 'rent') return 'rent';
  if (raw._priceType === 'sale') return 'sale';
  return 'sale';
}

// Strip query params and trailing slash so ?from=sale and ?ref=map variants
// don't create duplicate records for the same physical listing.
function canonicalListingUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch {
    return url.split('?')[0]!.replace(/\/+$/, '');
  }
}

async function upsertListing(
  raw: Record<string, unknown>,
  url: string,
  site: PartnerSite,
  forcePriceType?: 'sale' | 'rent',
): Promise<void> {
  // Use the canonical (query-param-free) URL as stable identity key
  const canonicalUrl = canonicalListingUrl(url);

  const price = typeof raw.price === 'number' ? raw.price : 0;
  const bedrooms = typeof raw.bedrooms === 'number' ? raw.bedrooms : null;
  const bathrooms = typeof raw.bathrooms === 'number' ? raw.bathrooms : null;
  const areaSqm = typeof raw.area_sqm === 'number' ? raw.area_sqm : null;
  const parking = typeof raw.parking === 'number' ? raw.parking : null;
  const neighborhood = typeof raw.neighborhood === 'string' ? raw.neighborhood : '';
  const city = typeof raw.city === 'string' && raw.city ? raw.city : 'Rio de Janeiro';
  const coverPhoto = typeof raw.image_url === 'string' ? raw.image_url : null;
  const description = typeof raw.description === 'string' ? raw.description : '';
  const address = typeof raw.address === 'string' ? raw.address.toLowerCase().trim() : '';
  const propertyType = mapPropertyType(typeof raw.property_type === 'string' ? raw.property_type : '');
  const priceType: 'sale' | 'rent' = forcePriceType ?? inferPriceType(raw, url);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.propertySource_.findUnique({
      where: { source_externalId: { source: 'portal_x', externalId: canonicalUrl } },
    });

    if (existing) {
      // Refresh price, cover photo, and mark active again in case it was deactivated
      await tx.property.update({
        where: { id: existing.propertyId },
        data: {
          price,
          active: true,
          lastSeenAt: new Date(),
          ...(bedrooms !== null ? { bedrooms } : {}),
          ...(bathrooms !== null ? { bathrooms } : {}),
          ...(areaSqm !== null ? { areaSqm } : {}),
          ...(parking !== null ? { parkingSpots: parking } : {}),
          ...(neighborhood ? { neighborhood } : {}),
        },
      });
      await tx.propertySource_.update({
        where: { id: existing.id },
        data: {
          rawPrice: price,
          url: canonicalUrl,
          ...(description ? { description } : {}),
          ...(coverPhoto ? { photos: [coverPhoto] } : {}),
          scrapedAt: new Date(),
          partnerSiteId: site.id,
        },
      });
    } else {
      // Sanity check price range (outside 0 < p < 1B means broken source data)
      const sanitizedPrice = price > 0 && price < 1_000_000_000 ? price : 0;

      const property = await tx.property.create({
        data: {
          addressNormalized: address || '',
          neighborhood: neighborhood || undefined,
          city,
          state: 'RJ',
          propertyType,
          bedrooms,
          bathrooms,
          areaSqm: areaSqm !== null ? areaSqm : undefined,
          parkingSpots: parking !== null ? parking : undefined,
          price: sanitizedPrice,
          priceType,
          active: true,
        },
      });

      await tx.propertySource_.create({
        data: {
          propertyId: property.id,
          source: 'portal_x',
          externalId: canonicalUrl,
          url: canonicalUrl,
          title: String(raw.title ?? ''),
          description: description || undefined,
          photos: coverPhoto ? [coverPhoto] : [],
          rawPrice: sanitizedPrice,
          rawData: raw as object,
          partnerSiteId: site.id,
        },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// WP REST API field-mode detection
//
// Probes the first item from a CPT to determine how listing data is stored:
//   direct  — top-level fields (valor, quartos, metragem) like Invexo/estate
//   meta    — item.meta object with a vendor prefix  (impacto_imovel_*) like Real Up
//   url_only — no structured data; only links available (ACF empty)
// ---------------------------------------------------------------------------

type WpFieldMode = 'direct' | 'meta' | 'url_only';

function detectWpFieldMode(item: Record<string, unknown>): { mode: WpFieldMode; metaPrefix: string } {
  const directPriceFields = ['valor', 'preco', 'price', 'valor_venda', 'preco_venda'];
  for (const f of directPriceFields) {
    if (item[f] !== undefined && item[f] !== null && item[f] !== '' && Number(item[f]) > 0) {
      return { mode: 'direct', metaPrefix: '' };
    }
  }

  const meta = item.meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const metaObj = meta as Record<string, unknown>;
    const pricePatterns = ['valor_venda', 'valor_aluguel', 'valor', 'preco', 'price'];
    for (const key of Object.keys(metaObj)) {
      const lower = key.toLowerCase();
      for (const pp of pricePatterns) {
        const idx = lower.indexOf(pp);
        if (idx >= 0 && metaObj[key] !== undefined && metaObj[key] !== null && metaObj[key] !== '') {
          return { mode: 'meta', metaPrefix: key.slice(0, idx) };
        }
      }
    }
    if (Object.keys(metaObj).length > 0) {
      return { mode: 'meta', metaPrefix: '' };
    }
  }

  return { mode: 'url_only', metaPrefix: '' };
}

function extractFromWpMeta(meta: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const g = (suffix: string): unknown => meta[`${prefix}${suffix}`] ?? meta[suffix];

  const finalidade = String(g('finalidade') ?? '').toLowerCase();
  const isRent = finalidade.includes('aluguel') || finalidade.includes('locaç');
  const priceType: 'sale' | 'rent' = isRent ? 'rent' : 'sale';

  const priceRaw = isRent
    ? (g('valor_aluguel') ?? g('valor'))
    : (g('valor_venda') ?? g('valor'));

  return {
    price: Number(priceRaw) || 0,
    bedrooms: Number(g('quartos')) || null,
    bathrooms: Number(g('banheiros')) || null,
    area_sqm: Number(g('area_total') ?? g('area_privativa') ?? g('area_util') ?? g('area')) || null,
    parking: Number(g('vagas') ?? g('garagem')) || null,
    neighborhood: String(g('bairro') ?? ''),
    city: String(g('cidade') ?? 'Rio de Janeiro'),
    property_type: String(g('tipo') ?? ''),
    priceType,
    image_url: String(g('foto_destaque') ?? g('imagem_destaque') ?? g('foto_principal') ?? '') || undefined,
  };
}

// ---------------------------------------------------------------------------
// syncSiteViaWpApi — WordPress REST API sync, no Firecrawl credits
//
// Auto-detects field mode (direct / meta) from the first page so it works
// across different WP+CRM setups without per-site configuration.
// ---------------------------------------------------------------------------

async function syncSiteViaWpApi(site: PartnerSite, cpt: string, onProgress?: (e: SyncProgressEvent) => void): Promise<SyncResult> {
  const start = Date.now();
  let added = 0;
  let removed = 0;
  let errors = 0;

  const apiBase = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/${encodeURIComponent(cpt)}`;
  const PER_PAGE = 100;
  const allCanonicalUrls: string[] = [];

  let fieldMode: WpFieldMode = 'direct';
  let metaPrefix = '';
  let modeDetected = false;
  let page = 1;

  while (true) {
    const pageUrl =
      `${apiBase}?per_page=${PER_PAGE}&page=${page}` +
      `&_fields=id,link,title,meta,valor,quartos,suites,vagas,metragem,c_url`;

    let items: Record<string, unknown>[] = [];
    try {
      const resp = await fetch(pageUrl, { headers: { Accept: 'application/json' } });
      if (!resp.ok) break;
      items = (await resp.json()) as Record<string, unknown>[];
      if (items.length === 0) break;
    } catch (err) {
      logger.warn('wp_api_fetch_failed', { domain: site.domain, cpt, page, error: String(err) });
      break;
    }

    if (!modeDetected && items.length > 0) {
      const detection = detectWpFieldMode(items[0]!);
      fieldMode = detection.mode;
      metaPrefix = detection.metaPrefix;
      modeDetected = true;
      logger.info('wp_api_mode_detected', { domain: site.domain, cpt, mode: fieldMode, metaPrefix });
    }

    for (const item of items) {
      const link = String((item.c_url ?? item.link) ?? '');
      if (!link) { errors++; continue; }

      const canonical = canonicalListingUrl(link);
      allCanonicalUrls.push(canonical);

      let raw: Record<string, unknown>;

      if (fieldMode === 'meta') {
        const meta = (item.meta && !Array.isArray(item.meta) ? item.meta : {}) as Record<string, unknown>;
        raw = {
          url: canonical,
          title: (item.title as { rendered?: string } | undefined)?.rendered ?? '',
          ...extractFromWpMeta(meta, metaPrefix),
        };
      } else {
        // direct mode — fields live at the top level (Invexo/estate style)
        let neighborhood = '';
        let typeSlug = '';
        try {
          const segments = new URL(link).pathname.split('/').filter(Boolean);
          if (segments[1]) {
            neighborhood = segments[1]
              .split('-')
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ');
          }
          typeSlug = segments[2] ?? '';
        } catch { /* ignore */ }

        raw = {
          url: canonical,
          title: (item.title as { rendered?: string } | undefined)?.rendered ?? '',
          price: Number(item.valor ?? item.preco ?? item.price ?? 0),
          bedrooms: Number(item.quartos ?? 0) || null,
          bathrooms: null,
          area_sqm: Number(item.metragem ?? item.area ?? 0) || null,
          parking: Number(item.vagas ?? 0) || null,
          neighborhood,
          city: 'Rio de Janeiro',
          property_type: mapTypeFromUrlSlug(typeSlug),
          _priceType: 'sale' as const,
        };
      }

      if (!raw.price || !raw.title) { errors++; continue; }
      const priceType = raw.priceType as 'sale' | 'rent' | undefined;
      try {
        await upsertListing(raw, canonical, site, priceType ?? 'sale');
        added++;
      } catch (err) {
        logger.warn('wp_api_upsert_error', { url: canonical, error: String(err) });
        errors++;
      }
    }

    logger.info('wp_api_page_done', { domain: site.domain, cpt, page, items: items.length, totalAdded: added });
    onProgress?.({ phase: 'page', page, fetched: items.length, added });
    page++;
  }

  // Mark removed — properties in DB no longer returned by the API
  const knownSources = await prisma.propertySource_.findMany({
    where: { partnerSiteId: site.id },
    select: { url: true, propertyId: true },
  });
  const currentUrlSet = new Set(allCanonicalUrls);
  const removedSources = knownSources.filter((s) => !currentUrlSet.has(s.url));
  if (removedSources.length > 0) {
    const propertyIds = [...new Set(removedSources.map((s) => s.propertyId))];
    await prisma.property.updateMany({
      where: { id: { in: propertyIds } },
      data: { active: false },
    });
    removed = propertyIds.length;
  }

  await prisma.partnerSite.update({
    where: { id: site.id },
    data: {
      syncStatus: 'done',
      lastScrapedAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
      listingCount: allCanonicalUrls.length,
    },
  });

  const durationMs = Date.now() - start;
  logger.info('wp_api_sync_complete', { domain: site.domain, cpt, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}

// ---------------------------------------------------------------------------
// syncSiteViaWpUrlScrape — WP REST API for URL discovery + Firecrawl per page
//
// Used when the CPT exists in WP but has no structured data fields (e.g. ACF
// fields are empty). We get the complete URL list cheaply via the API, then
// scrape only new listings individually with Firecrawl.
// ---------------------------------------------------------------------------

async function syncSiteViaWpUrlScrape(site: PartnerSite, cpt: string): Promise<SyncResult> {
  const apiBase = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/${encodeURIComponent(cpt)}`;
  const PER_PAGE = 100;
  const allCanonicalUrls: string[] = [];
  let page = 1;

  // Step 1: collect all listing URLs from WP API (just links, no content)
  while (true) {
    const pageUrl = `${apiBase}?per_page=${PER_PAGE}&page=${page}&_fields=id,link`;
    let items: Record<string, unknown>[] = [];
    try {
      const resp = await fetch(pageUrl, { headers: { Accept: 'application/json' } });
      if (!resp.ok) break;
      items = (await resp.json()) as Record<string, unknown>[];
      if (items.length === 0) break;
    } catch (err) {
      logger.warn('wp_url_api_fetch_failed', { domain: site.domain, cpt, page, error: String(err) });
      break;
    }
    for (const item of items) {
      const link = String(item.link ?? '');
      if (link) allCanonicalUrls.push(canonicalListingUrl(link));
    }
    logger.info('wp_url_page_done', { domain: site.domain, cpt, page, items: items.length });
    page++;
  }

  const start = Date.now();
  let added = 0;
  let removed = 0;
  let errors = 0;

  if (allCanonicalUrls.length === 0) {
    logger.warn('wp_url_sync_no_listings', { domain: site.domain, cpt });
    await prisma.partnerSite.update({
      where: { id: site.id },
      data: { syncStatus: 'done', lastScrapedAt: new Date() },
    });
    return { added: 0, removed: 0, errors: 0, durationMs: 0 };
  }

  // Step 2: delta against DB
  const knownSources = await prisma.propertySource_.findMany({
    where: { partnerSiteId: site.id },
    select: { url: true, propertyId: true },
  });
  const knownUrlSet = new Set(knownSources.map((s) => s.url));
  const currentUrlSet = new Set(allCanonicalUrls);

  const newUrls = allCanonicalUrls.filter((url) => !knownUrlSet.has(url));
  const removedUrls = [...knownUrlSet].filter((url) => !currentUrlSet.has(url));

  logger.info('wp_url_sync_delta', {
    domain: site.domain, cpt, total: allCanonicalUrls.length, new: newUrls.length, removed: removedUrls.length,
  });

  // Step 3: mark removed inactive
  if (removedUrls.length > 0) {
    const removedSources = knownSources.filter((s) => removedUrls.includes(s.url));
    const propertyIds = [...new Set(removedSources.map((s) => s.propertyId))];
    await prisma.property.updateMany({
      where: { id: { in: propertyIds } },
      data: { active: false },
    });
    removed = propertyIds.length;
  }

  // Step 4: scrape new listings individually with Firecrawl
  const firecrawl = getFirecrawl();
  const SCRAPE_CONCURRENCY = 3;
  const ANTIBOT_LIMIT = 3;
  let consecutiveAntibotErrors = 0;
  let aborted = false;

  for (let i = 0; i < newUrls.length && !aborted; i += SCRAPE_CONCURRENCY) {
    const chunk = newUrls.slice(i, i + SCRAPE_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async (url) => {
        const result = await firecrawl.scrape(url, {
          formats: ['markdown'],
          onlyMainContent: false,
          timeout: 45000,
        });
        const markdown = (result as Record<string, unknown>).markdown as string | undefined ?? '';
        const raw = await extractFromMarkdown(markdown, url);
        return { url, raw };
      }),
    );

    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        const msg = String((outcome as PromiseRejectedResult).reason);
        if (msg.includes('antibot') || msg.includes('anti-bot') || msg.includes('SCRAPE_RETRY_LIMIT')) {
          consecutiveAntibotErrors++;
          if (consecutiveAntibotErrors >= ANTIBOT_LIMIT) {
            logger.warn('wp_url_antibot_abort', { domain: site.domain, skipped: newUrls.length - i });
            aborted = true;
          }
        } else {
          consecutiveAntibotErrors = 0;
        }
        errors++;
        continue;
      }
      consecutiveAntibotErrors = 0;
      const { url, raw } = outcome.value;
      if (!raw?.price || !raw?.title) { errors++; continue; }
      try {
        await upsertListing(raw, url, site);
        added++;
      } catch (err) {
        logger.warn('wp_url_upsert_error', { url, error: String(err) });
        errors++;
      }
    }

    if (i % (SCRAPE_CONCURRENCY * 10) === 0 || i + SCRAPE_CONCURRENCY >= newUrls.length) {
      logger.info('wp_url_scrape_progress', {
        domain: site.domain,
        done: Math.min(i + SCRAPE_CONCURRENCY, newUrls.length),
        total: newUrls.length,
        added,
      });
    }
  }

  // Step 5: update site stats
  await prisma.partnerSite.update({
    where: { id: site.id },
    data: {
      syncStatus: 'done',
      lastScrapedAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
      listingCount: allCanonicalUrls.length,
    },
  });

  const durationMs = Date.now() - start;
  logger.info('wp_url_sync_complete', { domain: site.domain, cpt, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}

// ---------------------------------------------------------------------------
// syncSiteViaSiteMidasApi — Sitemidas/MidasCRM Angular SPA internal API
//
// The Sitemidas platform exposes a hidden JSON endpoint /imoveis/resultado
// (POST, application/x-www-form-urlencoded) that powers the Angular frontend.
// With no-pagination=s it returns all listings in one call — zero Firecrawl.
// ---------------------------------------------------------------------------

async function syncSiteViaSiteMidasApi(site: PartnerSite, onProgress?: (e: SyncProgressEvent) => void): Promise<SyncResult> {
  const start = Date.now();
  let added = 0;
  let removed = 0;
  let errors = 0;

  const base = site.baseUrl.replace(/\/$/, '');
  const endpoint = `${base}/imoveis/resultado`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/javascript, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': `${base}/imoveis/venda`,
  };

  // Single call fetches all listings (venda + aluguel) without pagination
  let items: Record<string, unknown>[] = [];
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: 'tipoNegocio[V]=true&tipoNegocio[A]=true&no-pagination=s',
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as { imoveis?: Record<string, unknown>[] };
    items = data.imoveis ?? [];
  } catch (err) {
    logger.warn('sitemidas_api_fetch_failed', { domain: site.domain, error: String(err) });
  }

  logger.info('sitemidas_api_fetched', { domain: site.domain, total: items.length });
  onProgress?.({ phase: 'fetched', fetched: items.length, added: 0, total: items.length });

  const allCanonicalUrls: string[] = [];

  for (const item of items) {
    const path = String(item.link_detalhe ?? '');
    if (!path) { errors++; continue; }

    const url = canonicalListingUrl(`${base}${path}`);
    allCanonicalUrls.push(url);

    // Determine price and type
    const valorVenda = Number(item.valorVenda ?? 0);
    const valorAluguel = Number(item.valorAluguelAnual ?? item.valorAluguelMensal ?? 0);
    const price = valorVenda > 0 ? valorVenda : valorAluguel;
    const priceType: 'sale' | 'rent' = valorVenda > 0 ? 'sale' : 'rent';

    // Extract neighborhood from localizacao: "Bairro, Cidade - UF"
    const localizacao = String(item.localizacao ?? '');
    const neighborhood = localizacao.split(',')[0]?.trim() ?? '';
    const city = localizacao.split(',')[1]?.split('-')[0]?.trim() ?? 'Rio de Janeiro';

    // Main photo from imagem_caminho array
    const fotos = Array.isArray(item.imagem_caminho) ? item.imagem_caminho as Record<string, unknown>[] : [];
    const mainFoto = fotos.find((f) => f.principal === '1') ?? fotos[0];
    const imageUrl = mainFoto ? String(mainFoto.imagem_caminho ?? '') : '';

    const raw: Record<string, unknown> = {
      title: String(item.titulo ?? ''),
      price,
      bedrooms: Number(item.dormitorios ?? 0) || null,
      bathrooms: null,
      area_sqm: Number(item.areaTotal ?? item.areaUtil ?? 0) || null,
      parking: Number(item.garagem ?? 0) || null,
      neighborhood,
      city,
      property_type: String(item.tipoImovel ?? ''),
      image_url: imageUrl || undefined,
      priceType,
    };

    if (!raw.price || !raw.title) { errors++; continue; }
    try {
      await upsertListing(raw, url, site, priceType);
      added++;
    } catch (err) {
      logger.warn('sitemidas_api_upsert_error', { url, error: String(err) });
      errors++;
    }
    if (allCanonicalUrls.length % 25 === 0) {
      onProgress?.({ phase: 'processing', fetched: items.length, added, total: items.length });
    }
  }

  // Mark removed
  const knownSources = await prisma.propertySource_.findMany({
    where: { partnerSiteId: site.id },
    select: { url: true, propertyId: true },
  });
  const currentUrlSet = new Set(allCanonicalUrls);
  const removedSources = knownSources.filter((s) => !currentUrlSet.has(s.url));
  if (removedSources.length > 0) {
    const propertyIds = [...new Set(removedSources.map((s) => s.propertyId))];
    await prisma.property.updateMany({
      where: { id: { in: propertyIds } },
      data: { active: false },
    });
    removed = propertyIds.length;
  }

  await prisma.partnerSite.update({
    where: { id: site.id },
    data: {
      syncStatus: 'done',
      lastScrapedAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
      listingCount: allCanonicalUrls.length,
    },
  });

  const durationMs = Date.now() - start;
  logger.info('sitemidas_api_sync_complete', { domain: site.domain, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}

// ---------------------------------------------------------------------------
// syncSiteViaKenloApi — Kenlo (ex-Imobzi) platform: /api/listings?page=N
// ---------------------------------------------------------------------------

async function syncSiteViaKenloApi(site: PartnerSite, onProgress?: (e: SyncProgressEvent) => void): Promise<SyncResult> {
  const base = site.baseUrl.replace(/\/$/, '');
  const start = Date.now();
  let added = 0, removed = 0, errors = 0;
  const allCanonicalUrls: string[] = [];

  let page = 1;
  while (true) {
    let items: Record<string, unknown>[];
    try {
      const resp = await fetch(`${base}/api/listings?page=${page}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) { logger.warn('kenlo_api_fetch_failed', { domain: site.domain, page, status: resp.status }); break; }
      const data = (await resp.json()) as { count?: number; data?: unknown[] };
      items = (data.data ?? []) as Record<string, unknown>[];
    } catch (err) {
      logger.warn('kenlo_api_fetch_error', { domain: site.domain, page, error: String(err) });
      break;
    }
    if (items.length === 0) break;

    for (const item of items) {
      const relUrl = String(item.url ?? '');
      if (!relUrl) continue;
      const url = relUrl.startsWith('http') ? relUrl : `${base}${relUrl}`;
      allCanonicalUrls.push(url);

      const showPrice = String(item.show_price ?? 'NONE');
      const saleArr = item.sale_price as number[] | null;
      const rentArr = item.rent_price as number[] | null;
      const price = showPrice === 'SALE' ? (saleArr?.[0] ?? 0) : showPrice === 'RENT' ? (rentArr?.[0] ?? 0) : 0;
      const priceType: 'sale' | 'rent' = showPrice === 'RENT' ? 'rent' : 'sale';

      const raw: Record<string, unknown> = {
        title: String(item.website_title ?? item.picture_title ?? ''),
        price,
        bedrooms: (item.bedrooms as number[] | null)?.[0] ?? null,
        area_sqm: (item.area as number[] | null)?.[0] ?? null,
        neighborhood: String(item.neighborhood ?? item.neighborhood_display ?? ''),
        city: String(item.city ?? ''),
        property_type: String(item.property_type ?? ''),
        image_url: String(item.picture_full ?? '') || undefined,
        priceType,
      };

      try {
        await upsertListing(raw, url, site, priceType);
        added++;
      } catch (err) {
        logger.warn('kenlo_api_upsert_error', { domain: site.domain, url, error: String(err) });
        errors++;
      }
    }

    logger.info('kenlo_api_page_done', { domain: site.domain, page, fetched: items.length });
    onProgress?.({ phase: 'page', page, fetched: items.length, added });
    page++;
    if (page > 200) break;
  }

  const knownSources = await prisma.propertySource_.findMany({
    where: { partnerSiteId: site.id },
    select: { url: true, propertyId: true },
  });
  const currentSet = new Set(allCanonicalUrls);
  const removedSources = knownSources.filter((s) => !currentSet.has(s.url));
  if (removedSources.length > 0) {
    const ids = [...new Set(removedSources.map((s) => s.propertyId))];
    await prisma.property.updateMany({ where: { id: { in: ids } }, data: { active: false } });
    removed = ids.length;
  }

  await prisma.partnerSite.update({
    where: { id: site.id },
    data: { syncStatus: 'done', lastScrapedAt: new Date(), lastSuccessAt: new Date(), consecutiveFailures: 0, listingCount: allCanonicalUrls.length },
  });

  const durationMs = Date.now() - start;
  logger.info('kenlo_api_sync_complete', { domain: site.domain, pages: page - 1, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}

// ---------------------------------------------------------------------------
// syncSiteViaKarocaBuscar — Karioca custom platform: /buscar?finality_id=N (HTML)
// ---------------------------------------------------------------------------

async function syncSiteViaKarocaBuscar(site: PartnerSite, onProgress?: (e: SyncProgressEvent) => void): Promise<SyncResult> {
  const base = site.baseUrl.replace(/\/$/, '');
  const start = Date.now();
  let added = 0, removed = 0, errors = 0;
  const allCanonicalUrls: string[] = [];

  for (const [finalityId, priceType] of [['1', 'sale'], ['2', 'rent']] as const) {
    let page = 1;
    while (true) {
      let html: string;
      try {
        const resp = await fetch(`${base}/buscar?finality_id=${finalityId}&list=1&page=${page}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) break;
        html = await resp.text();
      } catch (err) {
        logger.warn('karioca_buscar_fetch_error', { domain: site.domain, finalityId, page, error: String(err) });
        break;
      }

      // Parse property cards — each card anchors on href="/imovel/"
      const cardMatches = [...html.matchAll(/href="(\/imovel\/[^"]+)"[\s\S]{0,3000}?(?=href="\/imovel\/|$)/g)];
      if (cardMatches.length === 0) break;

      for (const match of cardMatches) {
        const relUrl = match[1]!;
        const url = `${base}${relUrl}`;
        allCanonicalUrls.push(url);

        // Slice the card block
        const block = match[0];

        // Title — from alt attribute of the image
        const titleM = block.match(/aria-label="([^"]+?)(?:\.\})?"/);
        const title = titleM ? titleM[1]!.replace(/\.\}\}$/, '').trim() : relUrl.split('/').slice(-2, -1)[0]?.replace(/-/g, ' ') ?? '';

        // Neighborhood — uppercased paragraph before price (pattern: ALL CAPS - CITY)
        const neighM = block.match(/<p[^>]*>\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ ]+)\s*-\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ ]+)\s*<\/p>/);
        const neighborhood = neighM ? neighM[1]!.trim() : null;
        const city = neighM ? neighM[2]!.trim() : null;

        // Price — R$ X.XXX,XX
        const priceM = block.match(/R\$\s*([\d.,]+)/);
        const price = priceM ? parseFloat(priceM[1]!.replace(/\./g, '').replace(',', '.')) : null;

        // Area — NN m²
        const areaM = block.match(/([\d.,]+)\s*m²/);
        const areaSqm = areaM ? parseFloat(areaM[1]!.replace(',', '.')) : null;

        // Bedrooms — number after bed.svg
        const bedsM = block.match(/bed\.svg[^>]*>[\s\S]{0,100}<p[^>]*>\s*(\d+)/);
        const bedrooms = bedsM ? parseInt(bedsM[1]!, 10) : null;

        // Property type — badge before the image
        const typeM = block.match(/bg-blue-900[^>]*>[\s\S]{0,50}<p[^>]*>\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ ]+)\s*<\/p>/);
        const rawType = typeM ? typeM[1]!.trim() : '';

        // Image
        const imgM = block.match(/class="image[^"]*"[^>]*src="([^"]+)"/);
        const imageUrl = imgM ? imgM[1]! : null;

        const raw: Record<string, unknown> = {
          title,
          price: price ?? 0,
          bedrooms,
          area_sqm: areaSqm,
          neighborhood,
          city,
          property_type: rawType,
          image_url: imageUrl ?? undefined,
          priceType,
        };

        try {
          await upsertListing(raw, url, site, priceType);
          added++;
        } catch (err) {
          logger.warn('karioca_buscar_upsert_error', { domain: site.domain, url, error: String(err) });
          errors++;
        }
      }

      logger.info('karioca_buscar_page_done', { domain: site.domain, finalityId, page, cards: cardMatches.length });
      onProgress?.({ phase: 'page', page, fetched: cardMatches.length, added });
      page++;
      if (page > 50) break;
    }
  }

  // Mark removed
  const knownSources = await prisma.propertySource_.findMany({
    where: { partnerSiteId: site.id },
    select: { url: true, propertyId: true },
  });
  const currentSet = new Set(allCanonicalUrls);
  const removedSources = knownSources.filter((s) => !currentSet.has(s.url));
  if (removedSources.length > 0) {
    const ids = [...new Set(removedSources.map((s) => s.propertyId))];
    await prisma.property.updateMany({ where: { id: { in: ids } }, data: { active: false } });
    removed = ids.length;
  }

  await prisma.partnerSite.update({
    where: { id: site.id },
    data: { syncStatus: 'done', lastScrapedAt: new Date(), lastSuccessAt: new Date(), consecutiveFailures: 0, listingCount: allCanonicalUrls.length },
  });

  const durationMs = Date.now() - start;
  logger.info('karioca_buscar_sync_complete', { domain: site.domain, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}

function mapTypeFromUrlSlug(slug: string): string {
  if (slug.includes('cobertura') || slug.includes('penthouse')) return 'penthouse';
  if (slug.includes('studio') || slug.includes('kitnet')) return 'studio';
  if (slug.includes('apartamento')) return 'apartment';
  if (slug.includes('casa')) return 'house';
  if (slug.includes('comercial') || slug.includes('sala') || slug.includes('loja')) return 'commercial';
  if (slug.includes('terreno') || slug.includes('lote')) return 'land';
  return 'apartment';
}

function mapPropertyType(raw: string): 'apartment' | 'house' | 'studio' | 'penthouse' | 'commercial' | 'land' | 'other' {
  const t = raw.toLowerCase();
  if (t.includes('cobertura') || t.includes('penthouse')) return 'penthouse';
  if (t.includes('apartamento') || t.includes('apartment') || t === '') return 'apartment';
  if (t.includes('casa') || t.includes('house')) return 'house';
  if (t.includes('studio') || t.includes('kitnet')) return 'studio';
  if (t.includes('sala') || t.includes('commercial')) return 'commercial';
  if (t.includes('terreno') || t.includes('land') || t.includes('lote')) return 'land';
  return 'apartment';
}

// ---------------------------------------------------------------------------
// searchCachedInventory — query synced properties from DB (S3)
// Used by run-search.ts when the site has a recent sync (no Firecrawl needed).
// Applies broad pre-filters; hardFilter + LLM scorer handle precision.
// ---------------------------------------------------------------------------

export async function searchCachedInventory(
  site: PartnerSite,
  criteria: SearchCriteria,
): Promise<NormalizedListing[]> {
  // Build neighborhood pre-filter: strip accents so "Barra Olímpica" matches
  // DB rows stored as "BARRA OLIMPICA", "Barra Olimpica", etc.
  const neighborhoodCandidates = [
    ...(criteria.neighborhoods ?? []),
    ...(criteria.neighborhood ? [criteria.neighborhood] : []),
  ].flatMap((n) => {
    const stripped = n.normalize('NFD').replace(/[̀-ͯ]/g, '');
    // Return both accented and stripped forms; Prisma insensitive mode handles case
    return stripped !== n ? [n, stripped] : [n];
  });

  // Extract keyword tokens for partial matching (e.g. "Barra Olímpica" → ["Barra", "Olimpica"])
  const neighborhoodKeywords = [...new Set(
    neighborhoodCandidates.flatMap((n) => n.split(/\s+/).filter((t) => t.length >= 4)),
  )];

  const neighborhoodFilter = neighborhoodKeywords.length > 0
    ? {
        OR: neighborhoodKeywords.map((kw) => ({
          neighborhood: { contains: kw, mode: 'insensitive' as const },
        })),
      }
    : {};

  const hasNeighborhoodFilter = neighborhoodKeywords.length > 0;

  const properties = await prisma.property.findMany({
    where: {
      active: true,
      sources: { some: { partnerSiteId: site.id } },
      priceType: criteria.purpose === 'rent' ? 'rent' : 'sale',
      // Broad price guard — 50% slack to tolerate stale/incorrect source data
      ...(criteria.priceMax ? { price: { lte: criteria.priceMax * 1.5 } } : {}),
      // Bedroom floor — allow one fewer than requested to catch studios labelled as 0
      ...(criteria.bedroomsMin && criteria.bedroomsMin > 1
        ? { bedrooms: { gte: criteria.bedroomsMin - 1 } }
        : {}),
      // Neighborhood pre-filter: narrows the result set before the 300-row cap
      ...neighborhoodFilter,
    },
    include: {
      sources: {
        where: { partnerSiteId: site.id },
        orderBy: { scrapedAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { lastSeenAt: 'desc' },
    // When filtering by neighborhood the result set is already narrow — use 300.
    // Without a neighborhood filter keep the tighter cap to protect VPS RAM.
    take: hasNeighborhoodFilter ? 300 : 100,
  });

  return properties
    .filter((p) => p.sources.length > 0)
    .map((p) => {
      const src = p.sources[0]!;
      return {
        source: 'portal_x' as const,
        externalId: src.externalId ?? src.url,
        url: src.url,
        title: src.title ?? '',
        description: src.description ?? '',
        photos: Array.isArray(src.photos) ? (src.photos as string[]) : [],
        address: p.addressNormalized,
        neighborhood: p.neighborhood ?? '',
        city: p.city,
        state: p.state,
        propertyType: p.propertyType,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        areaSqm: p.areaSqm !== null ? Number(p.areaSqm) : null,
        parkingSpots: p.parkingSpots,
        price: Number(p.price),
        priceType: p.priceType as 'sale' | 'rent',
        furnished: p.furnished,
        amenities: [],
        extractedAmenities:
          (p.extractedAmenities as Record<string, boolean> | null) ?? {},
        geohash7: p.geohash7,
        lat: null,
        lng: null,
        scrapedAt: src.scrapedAt.toISOString(),
      };
    });
}
