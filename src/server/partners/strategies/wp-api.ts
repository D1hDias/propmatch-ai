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
import { logCoverageMetrics } from '../sync-coverage';

// ---------------------------------------------------------------------------
// WP REST API field-mode detection
// ---------------------------------------------------------------------------

type WpFieldMode = 'direct' | 'meta' | 'url_only' | 'real_homes';

function detectWpFieldMode(item: Record<string, unknown>): { mode: WpFieldMode; metaPrefix: string } {
  const directPriceFields = [
    'valor', 'preco', 'price', 'valor_venda', 'preco_venda',
    'valor_total', 'preco_total', 'venda', 'sale_price', 'list_price',
    'valor_locacao', 'preco_locacao', 'rent_price', 'aluguel',
  ];
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
    if (Object.keys(metaObj).length > 0) return { mode: 'meta', metaPrefix: '' };
  }

  const propertyMeta = item.property_meta;
  if (propertyMeta && typeof propertyMeta === 'object' && !Array.isArray(propertyMeta)) {
    const pm = propertyMeta as Record<string, unknown>;
    if (pm['REAL_HOMES_property_price'] !== undefined && pm['REAL_HOMES_property_price'] !== null && pm['REAL_HOMES_property_price'] !== '') {
      return { mode: 'real_homes', metaPrefix: '' };
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
    image_urls: (() => {
      for (const key of ['fotos', 'galeria', 'imagens', 'photos', 'gallery', 'images']) {
        const val = g(key);
        if (Array.isArray(val) && val.length > 0) {
          return (val as unknown[])
            .map((v) => (typeof v === 'string' ? v : typeof v === 'object' && v !== null ? String((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).src ?? '') : ''))
            .filter((u) => u.length > 0);
        }
      }
      return undefined;
    })(),
  };
}

function extractFromRealHomesMeta(
  pm: Record<string, unknown>,
  item: Record<string, unknown>,
  canonical: string,
  embeddedImageUrls: string[],
): Record<string, unknown> {
  const price = Number(pm['REAL_HOMES_property_price']) || 0;
  const bedrooms = Number(pm['REAL_HOMES_property_bedrooms']) || null;
  const bathrooms = Number(pm['REAL_HOMES_property_bathrooms']) || null;
  const areaSqm = Number(pm['REAL_HOMES_property_size']) || null;
  const parking = Number(pm['REAL_HOMES_property_garage']) || null;

  const address = String(pm['REAL_HOMES_property_address'] ?? '');
  const parts = address.split(',').map((s) => s.trim());
  const neighborhood = parts[0] ?? '';
  const city = parts[1] ?? 'Rio de Janeiro';

  const priceType: 'sale' | 'rent' = SEED_URL_RENT_RE.test(canonical) ? 'rent' : 'sale';

  return {
    url: canonical,
    title: (item.title as { rendered?: string } | undefined)?.rendered ?? '',
    price,
    bedrooms,
    bathrooms,
    area_sqm: areaSqm,
    parking,
    neighborhood,
    city,
    property_type: '',
    priceType,
    image_urls: embeddedImageUrls.length > 0 ? embeddedImageUrls : undefined,
  };
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

// ---------------------------------------------------------------------------
// syncSiteViaWpApi — WordPress REST API, full data available (no Firecrawl)
// ---------------------------------------------------------------------------

export async function syncSiteViaWpApi(
  site: PartnerSite,
  cpt: string,
  onProgress?: (e: SyncProgressEvent) => void,
): Promise<SyncResult> {
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
    const pageUrl = `${apiBase}?per_page=${PER_PAGE}&page=${page}&_embed=wp:featuredmedia`;

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

      const embedded = item._embedded as Record<string, unknown> | undefined;
      const featuredArr = Array.isArray(embedded?.['wp:featuredmedia'])
        ? (embedded!['wp:featuredmedia'] as Record<string, unknown>[])
        : [];
      const embeddedImageUrls = featuredArr
        .map((m) => m.source_url as string | undefined)
        .filter((u): u is string => typeof u === 'string' && u.length > 0);

      let raw: Record<string, unknown>;

      if (fieldMode === 'real_homes') {
        const pm = (item.property_meta && !Array.isArray(item.property_meta) ? item.property_meta : {}) as Record<string, unknown>;
        raw = extractFromRealHomesMeta(pm, item, canonical, embeddedImageUrls);
      } else if (fieldMode === 'meta') {
        const meta = (item.meta && !Array.isArray(item.meta) ? item.meta : {}) as Record<string, unknown>;
        const metaExtracted = extractFromWpMeta(meta, metaPrefix);
        const metaPhotos = Array.isArray(metaExtracted.image_urls)
          ? (metaExtracted.image_urls as string[])
          : metaExtracted.image_url
            ? [String(metaExtracted.image_url)]
            : [];
        const mergedPhotos = [...new Set([...metaPhotos, ...embeddedImageUrls])].filter(Boolean);
        raw = {
          url: canonical,
          title: (item.title as { rendered?: string } | undefined)?.rendered ?? '',
          ...metaExtracted,
          image_urls: mergedPhotos.length > 0 ? mergedPhotos : undefined,
        };
      } else {
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
          price: Number(item.valor ?? item.preco ?? item.price ?? item.valor_venda ?? item.preco_venda ?? item.venda ?? item.valor_total ?? 0),
          bedrooms: Number(item.quartos ?? item.dormitorios ?? item.bedrooms ?? item.rooms ?? 0) || null,
          bathrooms: Number(item.banheiros ?? item.suites ?? item.bathrooms ?? 0) || null,
          area_sqm: Number(item.metragem ?? item.area ?? item.area_total ?? item.area_util ?? item.area_privativa ?? 0) || null,
          parking: Number(item.vagas ?? item.garagem ?? item.parking ?? 0) || null,
          neighborhood,
          city: 'Rio de Janeiro',
          property_type: mapTypeFromUrlSlug(typeSlug),
          _priceType: 'sale' as const,
          image_urls: embeddedImageUrls.length > 0 ? embeddedImageUrls : undefined,
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

  try { await logCoverageMetrics(site.id, site.domain); } catch { /* non-critical */ }

  const durationMs = Date.now() - start;
  logger.info('wp_api_sync_complete', { domain: site.domain, cpt, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}
