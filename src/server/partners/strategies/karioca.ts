import 'server-only';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';
import type { PartnerSite } from '@prisma/client';
import {
  upsertListing,
  type SyncResult,
  type SyncProgressEvent,
} from '../sync-utils';
import { logCoverageMetrics } from '../sync-coverage';

export async function syncSiteViaKarocaBuscar(
  site: PartnerSite,
  onProgress?: (e: SyncProgressEvent) => void,
): Promise<SyncResult> {
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

      const cardMatches = [...html.matchAll(/href="(\/imovel\/[^"]+)"[\s\S]{0,3000}?(?=href="\/imovel\/|$)/g)];
      if (cardMatches.length === 0) break;

      for (const match of cardMatches) {
        const relUrl = match[1]!;
        const url = `${base}${relUrl}`;
        allCanonicalUrls.push(url);

        const block = match[0];

        const titleM = block.match(/aria-label="([^"]+?)(?:\.\})?"/);
        const title = titleM ? titleM[1]!.replace(/\.\}\}$/, '').trim() : relUrl.split('/').slice(-2, -1)[0]?.replace(/-/g, ' ') ?? '';

        const neighM = block.match(/<p[^>]*>\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ ]+)\s*-\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ ]+)\s*<\/p>/);
        const neighborhood = neighM ? neighM[1]!.trim() : null;
        const city = neighM ? neighM[2]!.trim() : null;

        const priceM = block.match(/R\$\s*([\d.,]+)/);
        const price = priceM ? parseFloat(priceM[1]!.replace(/\./g, '').replace(',', '.')) : null;

        const areaM = block.match(/([\d.,]+)\s*m²/);
        const areaSqm = areaM ? parseFloat(areaM[1]!.replace(',', '.')) : null;

        const bedsM = block.match(/bed\.svg[^>]*>[\s\S]{0,100}<p[^>]*>\s*(\d+)/);
        const bedrooms = bedsM ? parseInt(bedsM[1]!, 10) : null;

        const typeM = block.match(/bg-blue-900[^>]*>[\s\S]{0,50}<p[^>]*>\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ ]+)\s*<\/p>/);
        const rawType = typeM ? typeM[1]!.trim() : '';

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
  logger.info('karioca_buscar_sync_complete', { domain: site.domain, added, removed, errors, uniqueUrls: currentSet.size, durationMs });
  return { added, removed, errors, durationMs };
}
