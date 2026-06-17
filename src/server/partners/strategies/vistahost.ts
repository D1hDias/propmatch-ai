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

export async function syncSiteViaVistaHostApi(
  site: PartnerSite,
  onProgress?: (e: SyncProgressEvent) => void,
): Promise<SyncResult> {
  const base = site.baseUrl.replace(/\/$/, '');
  const start = Date.now();
  let added = 0, removed = 0, errors = 0;
  const allCanonicalUrls: string[] = [];

  type VistaEndpoint = { url: string; version: 'v1' | 'v2' | 'v3'; pageParam: string };
  let endpoint: VistaEndpoint | null = null;

  const candidates: VistaEndpoint[] = [
    { url: `${base}/imoveis/resultado.json`, version: 'v2', pageParam: 'pagina' },
    { url: `${base}/imoveis`, version: 'v1', pageParam: 'pagina' },
    { url: `${base}/api/v1/imoveis`, version: 'v3', pageParam: 'page' },
    { url: `${base}/api/imoveis`, version: 'v3', pageParam: 'page' },
  ];

  for (const candidate of candidates) {
    try {
      const probeUrl = `${candidate.url}?finalidade=venda&${candidate.pageParam}=1`;
      const resp = await fetch(probeUrl, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) continue;
      const data = await resp.json() as Record<string, unknown>;
      const items = (data.imoveis ?? data.data ?? []) as unknown[];
      if (items.length > 0) {
        endpoint = candidate;
        logger.info('vistahost_api_endpoint_detected', { domain: site.domain, version: candidate.version, url: candidate.url });
        break;
      }
    } catch {
      // try next candidate
    }
  }

  if (!endpoint) {
    logger.warn('vistahost_api_no_endpoint', { domain: site.domain });
    await prisma.partnerSite.update({ where: { id: site.id }, data: { syncStatus: 'done', lastScrapedAt: new Date() } });
    return { added: 0, removed: 0, errors: 0, durationMs: Date.now() - start };
  }

  for (const [finalidade, priceType] of [['venda', 'sale'], ['aluguel', 'rent']] as const) {
    let page = 1;
    while (true) {
      const pageUrl = `${endpoint.url}?finalidade=${finalidade}&${endpoint.pageParam}=${page}`;
      let items: Record<string, unknown>[];
      try {
        const resp = await fetch(pageUrl, {
          headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) break;
        const data = await resp.json() as Record<string, unknown>;
        items = ((data.imoveis ?? data.data ?? []) as Record<string, unknown>[]);
      } catch (err) {
        logger.warn('vistahost_api_fetch_error', { domain: site.domain, finalidade, page, error: String(err) });
        break;
      }
      if (items.length === 0) break;

      for (const item of items) {
        const relUrl = String(item.link ?? item.url ?? item.slug ?? '');
        if (!relUrl) { errors++; continue; }
        const url = canonicalListingUrl(relUrl.startsWith('http') ? relUrl : `${base}${relUrl.startsWith('/') ? '' : '/'}${relUrl}`);
        allCanonicalUrls.push(url);

        const price = Number(
          item.valor_venda ?? item.preco_venda ?? item.valor ?? item.preco ??
          item.valor_aluguel ?? item.preco_aluguel ?? 0
        );

        const fotosRaw = Array.isArray(item.fotos) ? item.fotos as Record<string, unknown>[] : [];
        const imageUrls = fotosRaw
          .map((f) => {
            const src = String(f.link ?? f.url ?? f.src ?? f.arquivo ?? '');
            return src.startsWith('http') ? src : src ? `https://cdn.vistahost.com.br${src.startsWith('/') ? '' : '/'}${src}` : '';
          })
          .filter((u) => u.length > 0);
        const fotoPrincipal = String(item.foto_principal ?? item.foto ?? item.imagem ?? '');
        if (fotoPrincipal && !imageUrls.includes(fotoPrincipal)) {
          imageUrls.unshift(fotoPrincipal.startsWith('http') ? fotoPrincipal : `https://cdn.vistahost.com.br${fotoPrincipal}`);
        }

        const neighborhood = String(item.bairro ?? item.neighborhood ?? (String(item.localizacao ?? '').split(',')[0] ?? '')).trim();

        const raw: Record<string, unknown> = {
          title: String(item.titulo ?? item.title ?? item.nome ?? ''),
          price,
          bedrooms: Number(item.quartos ?? item.dormitorios ?? item.bedrooms ?? 0) || null,
          bathrooms: Number(item.banheiros ?? item.suites ?? 0) || null,
          area_sqm: Number(item.area_total ?? item.area ?? item.metragem ?? 0) || null,
          parking: Number(item.vagas ?? item.garagem ?? 0) || null,
          neighborhood,
          city: String(item.cidade ?? 'Rio de Janeiro'),
          property_type: String(item.tipo ?? item.category ?? ''),
          image_urls: imageUrls.length > 0 ? imageUrls : undefined,
          priceType,
        };

        if (!raw.price || !raw.title) { errors++; continue; }
        try {
          await upsertListing(raw, url, site, priceType);
          added++;
        } catch (err) {
          logger.warn('vistahost_api_upsert_error', { domain: site.domain, url, error: String(err) });
          errors++;
        }
      }

      logger.info('vistahost_api_page_done', { domain: site.domain, finalidade, page, fetched: items.length });
      onProgress?.({ phase: 'page', page, fetched: items.length, added });
      page++;
      if (page > 200) break;
    }
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
    data: { syncStatus: 'done', lastScrapedAt: new Date(), lastSuccessAt: new Date(), consecutiveFailures: 0, listingCount: currentSet.size },
  });

  try { await logCoverageMetrics(site.id, site.domain); } catch { /* non-critical */ }

  const durationMs = Date.now() - start;
  logger.info('vistahost_api_sync_complete', { domain: site.domain, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}
