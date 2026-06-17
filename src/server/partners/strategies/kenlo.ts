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

export async function syncSiteViaKenloApi(
  site: PartnerSite,
  onProgress?: (e: SyncProgressEvent) => void,
): Promise<SyncResult> {
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
        image_urls: Object.keys(item)
          .filter((k) => k.startsWith('picture_') && typeof item[k] === 'string' && (item[k] as string).length > 0)
          .sort((a, b) => (a === 'picture_full' ? -1 : b === 'picture_full' ? 1 : a.localeCompare(b)))
          .map((k) => item[k] as string) || undefined,
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
    data: { syncStatus: 'done', lastScrapedAt: new Date(), lastSuccessAt: new Date(), consecutiveFailures: 0, listingCount: currentSet.size },
  });

  try { await logCoverageMetrics(site.id, site.domain); } catch { /* non-critical */ }

  const durationMs = Date.now() - start;
  logger.info('kenlo_api_sync_complete', { domain: site.domain, pages: page - 1, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}
