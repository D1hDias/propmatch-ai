import 'server-only';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';
import type { PartnerSite } from '@prisma/client';
import {
  upsertListing,
  type SyncResult,
  type SyncProgressEvent,
} from '../sync-utils';

interface EgoRealEstateProperty {
  ID: number;
  UID: string;
  Reference: string;
  Title: string;
  Type: string;
  Parish: string;
  Zone: string;
  Municipality: string;
  Rooms: number;
  Bathrooms: number;
  NetArea: number;
  GrossArea: number;
  LandArea: number;
  Description: string;
  Thumbnail: string;
  Images: Array<{ Thumbnail: string; Thumbnail_640X480: string; Original: string }>;
  PropertyBusiness: Array<{
    BusinessID: number;
    Prices: Array<{ PriceValue: number; FormattedPrice: string }>;
  }>;
}

export async function syncSiteViaEgoRealEstateApi(
  site: PartnerSite,
  onProgress?: (e: SyncProgressEvent) => void,
): Promise<SyncResult> {
  const cfg = (site.searchConfig ?? {}) as Record<string, unknown>;
  const authToken = String(cfg.authToken ?? '');
  const lbl = String(cfg.lbl ?? '');
  if (!authToken) throw new Error('egorealestate_api: authToken missing in searchConfig');

  const start = Date.now();
  let added = 0, removed = 0, errors = 0;
  const allCanonicalUrls: string[] = [];
  const base = site.baseUrl.replace(/\/$/, '');
  const EGO_API = 'https://websiteapi.egorealestate.com/v1/Properties';
  const PAGE_SIZE = 50;
  const busTypes = (cfg.bus as string[] | undefined) ?? ['1', '2'];

  let anyPageSucceeded = false;

  for (const bus of busTypes) {
    const priceType: 'sale' | 'rent' = bus === '2' ? 'rent' : 'sale';
    let page = 1;
    let totalRecords: number | null = null;

    while (true) {
      const vui = crypto.randomUUID();
      const params: Record<string, string> = {
        restparams: '', nre: String(PAGE_SIZE), stt_not_in: '104,7',
        bus, gather_attributes: '1', dsrt: '1', lng: 'pt-br',
        oar: '1', vui, pag: String(page), _: String(Date.now()),
      };
      if (lbl) params.lbl = lbl;
      const qs = new URLSearchParams(params).toString();

      let props: EgoRealEstateProperty[] = [];
      let total = 0;
      try {
        const resp = await fetch(`${EGO_API}?${qs}`, {
          headers: {
            authorizationtoken: authToken,
            'x-served-by': 'JanelaDigital',
            'x-async': 'true',
            userinfotoken: '',
            accept: 'application/json, text/javascript, */*; q=0.01',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Referer: site.baseUrl,
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Linux"',
          },
          signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) {
          const jdWarning = resp.headers.get('jd-warning');
          logger.warn('egorealestate_api_http_error', { domain: site.domain, bus, page, status: resp.status, jdWarning });
          if (resp.status === 430 || resp.status === 403) {
            throw new Error(`egorealestate_api: IP blocked by EgoRealEstate (HTTP ${resp.status}, jd-warning: ${jdWarning ?? 'none'})`);
          }
          break;
        }
        const data = (await resp.json()) as { Properties: EgoRealEstateProperty[]; TotalRecords: number };
        props = data.Properties ?? [];
        total = data.TotalRecords ?? 0;
        anyPageSucceeded = true;
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('egorealestate_api:')) throw err;
        logger.warn('egorealestate_api_fetch_error', { domain: site.domain, bus, page, error: String(err) });
        break;
      }
      if (props.length === 0) break;
      if (totalRecords === null) totalRecords = total;

      for (const prop of props) {
        const propUrl = `${base}/imovel/${prop.ID}`;
        allCanonicalUrls.push(propUrl);

        const bizEntry = prop.PropertyBusiness?.find((b) => b.BusinessID === Number(bus));
        const price = bizEntry?.Prices?.[0]?.PriceValue ?? 0;
        const area =
          prop.NetArea > 0 ? prop.NetArea :
          prop.GrossArea > 0 ? prop.GrossArea :
          prop.LandArea > 0 ? prop.LandArea : null;
        const imageUrls = (prop.Images ?? [])
          .slice(0, 15)
          .map((img) => img.Thumbnail_640X480 || img.Original || img.Thumbnail)
          .filter(Boolean);

        const raw: Record<string, unknown> = {
          title: prop.Title || `${prop.Type} ${prop.Parish}`.trim(),
          price,
          bedrooms: prop.Rooms > 0 ? prop.Rooms : null,
          bathrooms: prop.Bathrooms > 0 ? prop.Bathrooms : null,
          area_sqm: area,
          neighborhood: prop.Parish || prop.Zone || '',
          city: prop.Municipality || 'Rio de Janeiro',
          property_type: prop.Type || '',
          description: prop.Description?.substring(0, 500) || '',
          image_urls: imageUrls.length > 0 ? imageUrls : undefined,
          priceType,
        };

        try {
          await upsertListing(raw, propUrl, site, priceType);
          added++;
        } catch (err) {
          logger.warn('egorealestate_api_upsert_error', { domain: site.domain, propId: prop.ID, error: String(err) });
          errors++;
        }
      }

      logger.info('egorealestate_api_page_done', { domain: site.domain, bus, page, fetched: props.length, added });
      onProgress?.({ phase: 'page', page, fetched: props.length, added, total: totalRecords ?? undefined });
      page++;
      if (page > 500) break;
    }
  }

  const currentSet = new Set(allCanonicalUrls);

  if (anyPageSucceeded) {
    const knownSources = await prisma.propertySource_.findMany({
      where: { partnerSiteId: site.id },
      select: { url: true, propertyId: true },
    });
    const removedSources = knownSources.filter((s) => !currentSet.has(s.url));
    if (removedSources.length > 0) {
      const ids = [...new Set(removedSources.map((s) => s.propertyId))];
      await prisma.property.updateMany({ where: { id: { in: ids } }, data: { active: false } });
      removed = ids.length;
    }
  }

  await prisma.partnerSite.update({
    where: { id: site.id },
    data: { syncStatus: 'done', lastScrapedAt: new Date(), lastSuccessAt: new Date(), consecutiveFailures: 0, listingCount: currentSet.size },
  });

  const durationMs = Date.now() - start;
  logger.info('egorealestate_api_sync_complete', { domain: site.domain, added, removed, errors, durationMs });
  return { added, removed, errors, durationMs };
}
