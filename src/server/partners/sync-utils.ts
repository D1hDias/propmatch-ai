import 'server-only';
import FirecrawlApp from '@mendable/firecrawl-js';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';
import { callLLM } from '@/server/lib/llm';
import { MODELS, MODEL_FALLBACKS } from '@/server/lib/models';
import type { PartnerSite } from '@prisma/client';

// ---------------------------------------------------------------------------
// Firecrawl client singleton
// ---------------------------------------------------------------------------

let _firecrawl: FirecrawlApp | null = null;

export function getFirecrawl(): FirecrawlApp {
  if (!_firecrawl) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set');
    _firecrawl = new FirecrawlApp({ apiKey, apiUrl: process.env.FIRECRAWL_API_URL });
  }
  return _firecrawl;
}

// ---------------------------------------------------------------------------
// LLM extraction prompts
// ---------------------------------------------------------------------------

export const EXTRACTION_SYSTEM_PROMPT =
  'Você é um extrator de dados de imóveis. Leia o texto de uma página de anúncio e retorne um JSON com os campos: ' +
  'title (string), price (número BRL sem R$ ou pontos), bedrooms (número), bathrooms (número), ' +
  'area_sqm (número), parking (número), neighborhood (string), city (string), ' +
  'property_type (string), description (string max 200 chars), address (string), ' +
  'image_urls (array de strings — URLs de TODAS as fotos do imóvel encontradas na página, incluindo og:image, galeria, slides e qualquer <img> com foto do imóvel; mínimo 1, máximo 20). ' +
  'Omita campos não encontrados. Responda APENAS com o JSON, sem texto adicional.';

export const BULK_EXTRACTION_SYSTEM_PROMPT =
  'Você é um extrator de dados de imóveis. Leia o markdown de uma página de lista de imóveis. ' +
  'Retorne um JSON object com a chave "listings" contendo um array de imóveis. ' +
  'IMPORTANTE: cada imóvel deve ter o preço EXATO mostrado no card dele — não repita o mesmo preço para imóveis diferentes. ' +
  'Campos por imóvel: url (string — URL completa), title (string), price (número BRL sem R$ ou pontos), ' +
  'bedrooms (número), bathrooms (número), area_sqm (número), parking (número), ' +
  'neighborhood (string), city (string), property_type (string), ' +
  'image_urls (array de strings — URLs de todas as fotos visíveis no card ou galeria do imóvel; mínimo 1). ' +
  'Omita campos não encontrados. Responda APENAS com o JSON object {"listings":[...]}.';

export const DEFAULT_LISTING_PATTERNS = [
  '/imovel/', '/imoveis/', '/property/', '/listing/', '/apartamento/', '/casa/',
];

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface SeedListing {
  url: string;
  rawData: Record<string, unknown>;
}

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

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

export const SEED_URL_RENT_RE = /\/alugu[ae]|\/alugar\/|\/para-alugar\/|\/locac/i;

export const LISTING_ID_PARAMS = new Set([
  'imovel', 'id', 'listing', 'ref', 'codigo', 'cod', 'property',
  'imobiliaria_id', 'property_id', 'item',
]);

export function normaliseUrl(url: string): string {
  try { return new URL(url).href.replace(/\/$/, ''); } catch { return url.replace(/\/$/, ''); }
}

export function buildPaginatedUrl(url: string, page: number): string {
  if (page === 1) return url;
  try {
    const u = new URL(url);
    for (const param of ['page', 'pagina', 'pg', 'pag', 'p']) {
      if (u.searchParams.has(param)) {
        u.searchParams.set(param, String(page));
        return u.toString();
      }
    }
    const pathPatterns = ['/page/', '/pagina/', '/pg/'];
    for (const pat of pathPatterns) {
      if (u.pathname.includes(pat)) {
        u.pathname = u.pathname.replace(new RegExp(`${pat}\\d+`), `${pat}${page}`);
        return u.toString();
      }
    }
    u.searchParams.set('page', String(page));
    return u.toString();
  } catch {
    return url + (url.includes('?') ? '&' : '?') + 'page=' + page;
  }
}

export function canonicalListingUrl(url: string): string {
  try {
    const u = new URL(url);
    const idParams: string[] = [];
    for (const [key, value] of u.searchParams.entries()) {
      if (LISTING_ID_PARAMS.has(key.toLowerCase()) && /^[a-zA-Z0-9_-]{1,40}$/.test(value)) {
        idParams.push(`${key}=${value}`);
      }
    }
    const base = (u.origin + u.pathname).replace(/\/+$/, '');
    return idParams.length > 0 ? `${base}?${idParams.join('&')}` : base;
  } catch {
    return url.split('?')[0]!.replace(/\/+$/, '');
  }
}

// ---------------------------------------------------------------------------
// Photo/listing validation helpers
// ---------------------------------------------------------------------------

const INVALID_PHOTO_RE = /vendido|indisponiv|capa-site-filtro|chart\.googleapis\.com|qr[_-]?code/i;

export function filterValidPhotos(photos: string[]): string[] {
  return photos.filter((u) => {
    try {
      const parsed = new URL(u);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        !INVALID_PHOTO_RE.test(u);
    } catch {
      return false;
    }
  });
}

export function isListingSold(raw: Record<string, unknown>, allPhotos: string[]): boolean {
  const title = String(raw.title ?? '').toLowerCase();
  if (/\bvendido\b|\bindispon[íi]vel\b/.test(title)) return true;
  return allPhotos.some((u) => INVALID_PHOTO_RE.test(u));
}

const RENT_SIGNALS_RE = /locaç|locacao|aluguel|para\s+alugar|para\s+locaç|temporada/i;

export function inferPriceType(raw: Record<string, unknown>, url: string): 'sale' | 'rent' {
  const text = `${raw.title ?? ''} ${raw.description ?? ''}`;
  if (RENT_SIGNALS_RE.test(text)) return 'rent';
  if (/\/aluguel\/|\/alugar\/|\/para-alugar\//.test(url)) return 'rent';
  if (raw._priceType === 'rent') return 'rent';
  if (raw._priceType === 'sale') return 'sale';
  return 'sale';
}

export function mapPropertyType(
  raw: string,
): 'apartment' | 'house' | 'studio' | 'penthouse' | 'commercial' | 'land' | 'other' {
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
// LLM extraction
// ---------------------------------------------------------------------------

export async function extractFromMarkdown(
  markdown: string,
  url: string,
): Promise<Record<string, unknown> | null> {
  if (!markdown || markdown.trim().length < 50) return null;
  try {
    const resp = await callLLM({
      model: MODELS.listingSync,
      fallbackModels: MODEL_FALLBACKS.listingSync,
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

const BULK_CHUNK_SIZE = 8_000;
const BULK_CONCURRENCY = 5;

export async function extractBulkFromMarkdown(
  markdown: string,
  baseUrl: string,
): Promise<Record<string, unknown>[]> {
  if (!markdown || markdown.trim().length < 50) return [];

  const OVERLAP = 500;
  const chunks: string[] = [];
  for (let i = 0; i < markdown.length; i += BULK_CHUNK_SIZE - OVERLAP) {
    chunks.push(markdown.slice(i, i + BULK_CHUNK_SIZE));
    if (i + BULK_CHUNK_SIZE >= markdown.length) break;
  }

  const results: Record<string, unknown>[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < chunks.length; i += BULK_CONCURRENCY) {
    const batch = chunks.slice(i, i + BULK_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((chunk) =>
        callLLM({
          model: MODELS.listingSync,
          fallbackModels: MODEL_FALLBACKS.listingSync,
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
        // malformed JSON from LLM — skip chunk
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// discoverFromSeedUrls — scrape listing index pages, collect URLs + data
// ---------------------------------------------------------------------------

export async function discoverFromSeedUrls(
  site: PartnerSite,
  listingPatterns: string[],
): Promise<SeedListing[]> {
  if (site.seedUrls.length === 0) return [];

  const firecrawl = getFirecrawl();
  const discovered = new Map<string, SeedListing>();
  const MAX_PAGES_PER_SEED = 20;
  const siteOrigin = (() => {
    try { return new URL(site.baseUrl).origin; } catch { return site.baseUrl; }
  })();

  for (const seedUrl of site.seedUrls) {
    let page = 1;
    let emptyPages = 0;

    const seedPriceType = /aluguel|alugar|a-alugar|locacao|loca[çc]ao/i.test(seedUrl)
      ? 'rent' : 'sale';

    while (page <= MAX_PAGES_PER_SEED && emptyPages < 2) {
      const pageUrl = buildPaginatedUrl(seedUrl, page);
      try {
        const result = await firecrawl.scrape(pageUrl, {
          formats: ['markdown', 'links'],
          onlyMainContent: false,
          timeout: site.needsJavascript ? 90000 : 60000,
          ...(site.needsJavascript ? { waitFor: 3000 } : {}),
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
              try {
                const path = new URL(l).pathname;
                if (/^\/(blog|contato|sobre|equipe|servicos|politica|termos|privacidade|wp-|feed|sitemap|page|pagina|tag|categoria|author)\/?/i.test(path)) return false;
                if (path === '/') return false;
                const segments = path.split('/').filter(Boolean);
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

// ---------------------------------------------------------------------------
// upsertListing — write one scraped listing into properties + property_sources
// ---------------------------------------------------------------------------

export async function upsertListing(
  raw: Record<string, unknown>,
  url: string,
  site: PartnerSite,
  forcePriceType?: 'sale' | 'rent',
): Promise<void> {
  const canonicalUrl = canonicalListingUrl(url);

  const price = typeof raw.price === 'number' ? raw.price : 0;
  const bedrooms = typeof raw.bedrooms === 'number' ? raw.bedrooms : null;
  const bathrooms = typeof raw.bathrooms === 'number' ? raw.bathrooms : null;
  const areaSqm = typeof raw.area_sqm === 'number' ? raw.area_sqm : null;
  const parking = typeof raw.parking === 'number' ? raw.parking : null;
  const neighborhood = typeof raw.neighborhood === 'string' ? raw.neighborhood : '';
  const city = typeof raw.city === 'string' && raw.city ? raw.city : 'Rio de Janeiro';
  const rawPhotos: string[] = Array.isArray(raw.image_urls)
    ? (raw.image_urls as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
    : [];
  const coverPhoto = typeof raw.image_url === 'string' && raw.image_url ? raw.image_url : null;
  const allPhotos = rawPhotos.length > 0
    ? rawPhotos
    : coverPhoto
      ? [coverPhoto]
      : [];
  const validPhotos = filterValidPhotos(allPhotos);
  const sold = isListingSold(raw, allPhotos);
  const description = typeof raw.description === 'string' ? raw.description : '';
  const address = typeof raw.address === 'string' ? raw.address.toLowerCase().trim() : '';
  const propertyType = mapPropertyType(typeof raw.property_type === 'string' ? raw.property_type : '');
  const priceType: 'sale' | 'rent' = forcePriceType ?? inferPriceType(raw, url);

  if (sold) {
    const existing = await prisma.propertySource_.findUnique({
      where: { source_externalId: { source: 'portal_x', externalId: canonicalUrl } },
    });
    if (existing) {
      await prisma.property.update({
        where: { id: existing.propertyId },
        data: { active: false, lastSeenAt: new Date() },
      });
    }
    return;
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.propertySource_.findUnique({
      where: { source_externalId: { source: 'portal_x', externalId: canonicalUrl } },
    });

    if (existing) {
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
          ...(validPhotos.length > 0 ? { photos: validPhotos } : {}),
          scrapedAt: new Date(),
          partnerSiteId: site.id,
        },
      });
    } else {
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
          photos: validPhotos,
          rawPrice: sanitizedPrice,
          rawData: raw as object,
          partnerSiteId: site.id,
        },
      });
    }
  });
}
