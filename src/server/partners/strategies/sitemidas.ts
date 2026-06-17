import 'server-only';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';
import type { PartnerSite } from '@prisma/client';
import {
  canonicalListingUrl,
  upsertListing,
  type SyncResult,
  type SyncProgressEvent,
} from '../sync-utils';
import { logCoverageMetrics } from '../sync-coverage';

export async function syncSiteViaSiteMidasApi(
  site: PartnerSite,
  onProgress?: (e: SyncProgressEvent) => void,
): Promise<SyncResult> {
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

  let items: Record<string, unknown>[] = [];
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: 'tipoNegocio[V]=true&tipoNegocio[A]=true&no-pagination=s',
      signal: AbortSignal.timeout(60_000),
    });
    if (resp.ok) {
      const ct = resp.headers.get('content-type') ?? '';
      if (ct.includes('json')) {
        const data = (await resp.json()) as { imoveis?: Record<string, unknown>[] };
        items = data.imoveis ?? [];
      }
    }
  } catch {
    // fall through to paginated mode
  }

  if (items.length === 0) {
    logger.info('sitemidas_api_paginated_mode', { domain: site.domain });
    let lastPage = 1;
    for (let page = 1; page <= lastPage; page++) {
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: `tipoNegocio[V]=true&tipoNegocio[A]=true&page=${page}`,
          signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) break;
        const ct = resp.headers.get('content-type') ?? '';
        if (!ct.includes('json')) break;
        const data = (await resp.json()) as {
          imoveis?: Record<string, unknown>[];
          infos?: { ultimaPagina?: number };
        };
        const pageItems = data.imoveis ?? [];
        if (pageItems.length === 0) break;
        items.push(...pageItems);
        if (page === 1) lastPage = data.infos?.ultimaPagina ?? 1;
        onProgress?.({ phase: 'fetched', fetched: items.length, added: 0, total: lastPage * pageItems.length });
      } catch (err) {
        logger.warn('sitemidas_api_page_failed', { domain: site.domain, page, error: String(err) });
        break;
      }
    }
  }

  logger.info('sitemidas_api_fetched', { domain: site.domain, total: items.length });
  onProgress?.({ phase: 'fetched', fetched: items.length, added: 0, total: items.length });

  const allCanonicalUrls: string[] = [];

  for (const item of items) {
    const path = String(item.link_detalhe ?? '');
    if (!path) { errors++; continue; }

    const url = canonicalListingUrl(`${base}${path}`);
    allCanonicalUrls.push(url);

    const valorVenda = Number(item.valorVenda ?? 0);
    const valorAluguel = Number(item.valorAluguelAnual ?? item.valorAluguelMensal ?? 0);
    const price = valorVenda > 0 ? valorVenda : valorAluguel;
    const priceType: 'sale' | 'rent' = valorVenda > 0 ? 'sale' : 'rent';

    const localizacao = String(item.localizacao ?? '');
    const neighborhood = localizacao.split(',')[0]?.trim() ?? '';
    const city = localizacao.split(',')[1]?.split('-')[0]?.trim() ?? 'Rio de Janeiro';

    const fotos = Array.isArray(item.imagem_caminho) ? item.imagem_caminho as Record<string, unknown>[] : [];
    const fotosOrdered = [
      ...fotos.filter((f) => f.principal === '1'),
      ...fotos.filter((f) => f.principal !== '1'),
    ];
    const imageUrls = fotosOrdered
      .map((f) => String(f.imagem_caminho ?? ''))
      .filter((u) => u.length > 0);

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
      image_urls: imageUrls.length > 0 ? imageUrls : undefined,
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
  logger.info('sitemidas_api_sync_complete', { domain: site.domain, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}
