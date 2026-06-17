import 'server-only';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';
import type { PartnerSite } from '@prisma/client';
import {
  canonicalListingUrl,
  upsertListing,
  SEED_URL_RENT_RE,
  type SyncResult,
  type SyncProgressEvent,
} from '../sync-utils';

interface MapMarker {
  lat: number;
  lng: number;
  url?: string;
  link?: string;
  href?: string;
  permalink?: string;
  title?: string;
  titulo?: string;
  name?: string;
  nome?: string;
  valor?: number;
  valor_venda?: number;
  preco?: number;
  price?: number;
  value?: number;
  bairro?: string;
  neighborhood?: string;
  regiao?: string;
  valor_formatado?: string;
}

function extractMapMarkers(html: string): MapMarker[] {
  const results: MapMarker[] = [];
  for (const pattern of [
    /\{[^{}]*"lat"\s*:\s*-?\d+(?:\.\d+)?[^{}]*"lng"\s*:\s*-?\d+(?:\.\d+)?[^{}]*\}/g,
    /\{[^{}]*"lng"\s*:\s*-?\d+(?:\.\d+)?[^{}]*"lat"\s*:\s*-?\d+(?:\.\d+)?[^{}]*\}/g,
  ]) {
    for (const match of html.matchAll(pattern)) {
      try {
        const obj = JSON.parse(match[0]) as MapMarker;
        if (typeof obj.lat === 'number' && typeof obj.lng === 'number') results.push(obj);
      } catch { /* skip malformed JSON */ }
    }
  }
  const seen = new Map<string, MapMarker>();
  for (const m of results) {
    const key = m.url ?? m.link ?? m.href ?? m.permalink ?? `${m.lat},${m.lng}`;
    if (!seen.has(key)) seen.set(key, m);
  }
  return [...seen.values()];
}

function extractBedroomsAndArea(title: string): { bedrooms: number | null; areaSqm: number | null } {
  const t = title.toLowerCase();
  const areaMatch = t.match(/(\d+(?:[,\.]\d+)?)\s*m[²2]/);
  const areaSqm = areaMatch ? parseFloat(areaMatch[1]!.replace(',', '.')) : null;
  let bedrooms: number | null = null;
  if (/\bstudio\b|\bkitnet\b|\bkit\b/.test(t)) {
    bedrooms = 0;
  } else {
    const m = t.match(/(\d+)\s*(?:quarto|dormitório|dormitorio|suíte|suite)\w*/);
    if (m) bedrooms = parseInt(m[1]!, 10);
  }
  return { bedrooms, areaSqm };
}

function inferPriceTypeFromSeedUrl(pageUrl: string): 'sale' | 'rent' {
  return SEED_URL_RENT_RE.test(pageUrl) ? 'rent' : 'sale';
}

export async function syncSiteViaMapMarkers(
  site: PartnerSite,
  onProgress?: (e: SyncProgressEvent) => void,
): Promise<SyncResult> {
  const start = Date.now();
  const pages = site.seedUrls.length > 0
    ? site.seedUrls
    : [`${site.baseUrl}/imoveis/a-venda/`, `${site.baseUrl}/imoveis/aluguel/`];

  const byUrl = new Map<string, { marker: MapMarker; priceType: 'sale' | 'rent' }>();
  for (const pageUrl of pages) {
    try {
      const resp = await fetch(pageUrl, {
        signal: AbortSignal.timeout(20_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PropMatchBot/1.0)' },
      });
      if (!resp.ok) {
        logger.warn('map_markers_page_http_error', { domain: site.domain, pageUrl, status: resp.status });
        continue;
      }
      const html = await resp.text();
      const markers = extractMapMarkers(html);
      const priceType = inferPriceTypeFromSeedUrl(pageUrl);
      for (const m of markers) {
        const rawUrl = m.url ?? m.link ?? m.href ?? m.permalink ?? '';
        if (!rawUrl) continue;
        const absUrl = rawUrl.startsWith('/') ? new URL(rawUrl, site.baseUrl).href : rawUrl;
        const canonical = canonicalListingUrl(absUrl);
        if (!byUrl.has(canonical)) byUrl.set(canonical, { marker: m, priceType });
      }
      logger.info('map_markers_page_done', { domain: site.domain, pageUrl, count: markers.length });
    } catch (err) {
      logger.warn('map_markers_page_failed', { domain: site.domain, pageUrl, error: String(err) });
    }
    if (onProgress) onProgress({ phase: 'discover', fetched: byUrl.size, added: 0 });
  }

  const allCanonicalUrls = [...byUrl.keys()];

  if (allCanonicalUrls.length === 0) {
    logger.warn('map_markers_no_listings', { domain: site.domain });
    await prisma.partnerSite.update({
      where: { id: site.id },
      data: { syncStatus: 'done', lastScrapedAt: new Date() },
    });
    return { added: 0, removed: 0, errors: 0, durationMs: Date.now() - start };
  }

  const knownSources = await prisma.propertySource_.findMany({
    where: { partnerSiteId: site.id },
    select: { url: true, propertyId: true },
  });
  const knownUrlSet = new Set([...knownSources.map((s) => s.url), ...site.knownUrls]);
  const currentUrlSet = new Set(allCanonicalUrls);
  const newUrls = allCanonicalUrls.filter((u) => !knownUrlSet.has(u));
  const removedUrls = [...knownUrlSet].filter((u) => !currentUrlSet.has(u));

  logger.info('map_markers_delta', {
    domain: site.domain,
    total: allCanonicalUrls.length,
    new: newUrls.length,
    removed: removedUrls.length,
  });

  let added = 0;
  let removed = 0;
  let errors = 0;

  if (removedUrls.length > 0) {
    const removedSources = knownSources.filter((s) => removedUrls.includes(s.url));
    const propertyIds = [...new Set(removedSources.map((s) => s.propertyId))];
    if (propertyIds.length > 0) {
      await prisma.property.updateMany({
        where: { id: { in: propertyIds } },
        data: { active: false },
      });
      removed = propertyIds.length;
    }
  }

  for (const url of newUrls) {
    const { marker, priceType } = byUrl.get(url)!;
    const price = marker.valor ?? marker.valor_venda ?? marker.preco ?? marker.price ?? marker.value ?? 0;
    const title = marker.title ?? marker.titulo ?? marker.name ?? marker.nome ?? '';
    if (!price && !title) { errors++; continue; }

    const { bedrooms, areaSqm } = extractBedroomsAndArea(title);
    const neighborhood = marker.bairro ?? marker.neighborhood ?? marker.regiao ?? '';

    try {
      await upsertListing(
        { title, price, bedrooms, area_sqm: areaSqm, neighborhood },
        url,
        site,
        priceType,
      );
      added++;
    } catch (err) {
      logger.warn('map_markers_upsert_error', { domain: site.domain, url, error: String(err) });
      errors++;
    }

    if (onProgress && (added + errors) % 50 === 0) {
      onProgress({ phase: 'upsert', fetched: allCanonicalUrls.length, added, total: newUrls.length });
    }
  }

  await prisma.partnerSite.update({
    where: { id: site.id },
    data: {
      syncStatus: 'done',
      lastScrapedAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
      listingCount: allCanonicalUrls.length,
      knownUrls: allCanonicalUrls,
    },
  });

  const durationMs = Date.now() - start;
  logger.info('map_markers_sync_complete', { domain: site.domain, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}
