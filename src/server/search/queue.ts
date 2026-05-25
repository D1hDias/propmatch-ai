import 'server-only';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '@/server/lib/logger';
import { prisma } from '@/server/db/client';
import { runSearch } from './run-search';
import { deduplicate } from './dedup';
import { scoreListings } from './hybrid-scorer';
import { geocode } from './geocoder';
import { normalizeAddress } from './normalize-address';
import { proposeWidens, AUTO_WIDEN_THRESHOLD } from './auto-widen';
import type { SearchCriteria, NormalizedListing } from './types';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Let ioredis parse the URL directly — it handles rediss://, TLS, and special
// characters in passwords correctly without manual URL decomposition.
function redisConnection() {
  return new Redis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

const connection = redisConnection();

export const searchQueue = new Queue('search', { connection });

export interface SearchJobData {
  briefingId: string;
  userId: string;
  criteria: unknown;
  customUrls?: string[];      // imobiliária URLs provided by broker
  partnerSiteIds?: string[];  // specific partner sites selected in the briefing form
  autoWiden?: boolean;        // true when this is a widen re-run
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

let workerStarted = false;

export function startSearchWorker(): void {
  if (workerStarted) return;
  workerStarted = true;

  const worker = new Worker<SearchJobData>(
    'search',
    async (job: Job<SearchJobData>) => {
      const { briefingId, userId, criteria: rawCriteria, customUrls, partnerSiteIds, autoWiden = false } = job.data;
      const criteria = rawCriteria as SearchCriteria;

      logger.info('search_job_started', { briefingId, jobId: job.id, autoWiden, customUrlCount: customUrls?.length ?? 0, partnerSiteCount: partnerSiteIds?.length ?? 0 });

      try {
        // 1. Fan-out scraping (partner sites + custom URLs)
        const { listings: raw, sourceErrors, customUrlResults, durationMs } = await runSearch(criteria, { customUrls, userId, partnerSiteIds });

        // 2. Geocode listings missing lat/lng (Nominatim, 1 req/s)
        const geocoded = await enrichWithGeo(raw);

        // 3. Deduplicate
        const deduped = deduplicate(geocoded);
        logger.info('dedup complete', {
          before: geocoded.length,
          after: deduped.length,
          briefingId,
        });

        // 4. Hard pre-filter — eliminates obvious mismatches before scoring
        const preFiltered = hardFilter(deduped, criteria);
        logger.info('hard filter', { before: deduped.length, after: preFiltered.length, briefingId });

        // 5. Hybrid scoring — deterministic weighted criteria (Tipo 25 + Bairro 25 + Preço 25 + Quartos 15 + Área 10)
        // Score everything first (minScore=0) to count below-threshold results for UI feedback.
        const allScored = scoreListings(preFiltered, criteria, 0);
        const matched = allScored.filter((r) => r.score >= 60);
        const belowThresholdCount = allScored.length - matched.length;
        logger.info('hybrid score complete', {
          before: preFiltered.length,
          qualified: matched.length,
          belowThreshold: belowThresholdCount,
          briefingId,
        });

        // 6. Persist properties + briefing_results
        const qualified = matched.map((m) => ({
          listing: m.listing,
          score: m.score,
          scoreBreakdown: {
            method: 'hybrid',
            reason: m.reason,
            ...m.breakdown,
          } as Record<string, unknown>,
        }));
        await persistResults(briefingId, qualified, autoWiden);

        // 8. Auto-widen check — if results < 5 and this was not already a widen
        const widenProposals =
          !autoWiden && qualified.length < AUTO_WIDEN_THRESHOLD
            ? proposeWidens(criteria, qualified.length)
            : [];

        // Update briefing status.
        // Preserve the original extractedCriteria (SearchCriteria camelCase); only
        // append metadata keys so re-search never sees null criteria.
        const metaUpdate = widenProposals.length > 0 || customUrlResults.length > 0 || belowThresholdCount > 0;
        if (metaUpdate) {
          const current = await prisma.briefing.findUnique({
            where: { id: briefingId },
            select: { extractedCriteria: true },
          });
          const merged = {
            ...(current?.extractedCriteria as Record<string, unknown> ?? {}),
            ...(widenProposals.length > 0 ? { _widenProposals: widenProposals as unknown[] } : {}),
            ...(customUrlResults.length > 0 ? { _customUrlResults: customUrlResults } : {}),
            ...(belowThresholdCount > 0 ? { _belowThresholdCount: belowThresholdCount } : {}),
          };
          await prisma.briefing.update({
            where: { id: briefingId },
            data: {
              status: 'ready',
              autoWidenUsed: autoWiden,
              extractedCriteria: merged as object,
            },
          });
        } else {
          await prisma.briefing.update({
            where: { id: briefingId },
            data: {
              status: 'ready',
              autoWidenUsed: autoWiden,
            },
          });
        }

        logger.info('search job complete', {
          briefingId,
          results: qualified.length,
          durationMs,
          sourceErrors: sourceErrors.length,
          widenProposals: widenProposals.length,
        });
      } catch (err) {
        logger.error('search job failed', { briefingId, error: err });
        await prisma.briefing.update({
          where: { id: briefingId },
          data: { status: 'failed' },
        });
        throw err;
      }
    },
    { connection, concurrency: 3 },
  );

  worker.on('failed', (job, err) => {
    logger.error('search worker job failed', { jobId: job?.id, error: err });
  });
}

// ---------------------------------------------------------------------------
// Hard pre-filter — eliminates obvious mismatches before scoring
// ---------------------------------------------------------------------------

function normStr(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/** Returns true when listing neighborhood matches at least one criteria neighborhood. */
function neighborhoodOk(listing: NormalizedListing, criteria: SearchCriteria): boolean {
  const hasCriteria = (criteria.neighborhoods?.length ?? 0) > 0 || !!criteria.neighborhood;
  if (!hasCriteria) return true;
  // If listing has no neighborhood data, give benefit of the doubt (don't discard)
  if (!listing.neighborhood) return true;

  const lnorm = normStr(listing.neighborhood);
  const candidates = [
    ...(criteria.neighborhoods ?? []),
    ...(criteria.neighborhood ? [criteria.neighborhood] : []),
  ];

  return candidates.some((n) => {
    const cnorm = normStr(n);
    return lnorm.includes(cnorm) || cnorm.includes(lnorm);
  });
}

// Residential vs commercial category split — used for absolute hard blocks.
// Residential: apartment, house, studio, penthouse and equivalents.
// Commercial: commercial space, warehouse, land.
const RESIDENTIAL_TYPES = ['apartment', 'apartamento', 'house', 'casa', 'studio', 'estudio',
  'kitnet', 'penthouse', 'cobertura', 'flat', 'loft', 'sobrado', 'other'];
const COMMERCIAL_TYPES  = ['commercial', 'comercial', 'warehouse', 'galpao', 'land',
  'terreno', 'lote', 'sala', 'loja', 'andar'];

function propertyCategory(type: string): 'residential' | 'commercial' | 'unknown' {
  const t = normStr(type);
  if (RESIDENTIAL_TYPES.some((r) => t === r || t.startsWith(r))) return 'residential';
  if (COMMERCIAL_TYPES.some((c)  => t === c || t.startsWith(c))) return 'commercial';
  return 'unknown';
}

function hardFilter(listings: NormalizedListing[], criteria: SearchCriteria): NormalizedListing[] {
  return listings.filter((l) => {
    // 1. Purpose mismatch → hard discard (only when priceType is known)
    if (criteria.purpose === 'buy' && l.priceType === 'rent') return false;
    if (criteria.purpose === 'rent' && l.priceType === 'sale') return false;

    // 1b. Price-floor sanity: sale prices in Brazil are never < R$30k.
    //     Values below this are almost certainly monthly rent prices that were
    //     mis-classified as sale during scraping.
    if (criteria.purpose === 'buy' && l.price > 0 && l.price < 30_000) return false;

    // 2. Property type checks — two levels:
    if (criteria.propertyType && l.propertyType) {
      const critCat = propertyCategory(criteria.propertyType);
      const listCat = propertyCategory(l.propertyType);

      // 2a. Residential ↔ Commercial → absolute hard discard (no exceptions)
      if (critCat !== 'unknown' && listCat !== 'unknown' && critCat !== listCat) return false;

      // 2b. Same-category subtype mismatch (e.g. apartment requested, house found):
      //     Allowed only when ALL of these hold:
      //       - neighborhood is in criteria (or unknown)
      //       - price ≤ priceMin × 1.20 (tight — within 20% of stated floor)
      //       - price ≤ priceMax (if set)
      //       - bedrooms within range
      if (normStr(l.propertyType) !== normStr(criteria.propertyType)) {
        if (!neighborhoodOk(l, criteria)) return false;
        if (criteria.priceMin != null && l.price > 0 && l.price > criteria.priceMin * 1.20) return false;
        if (criteria.priceMax != null && l.price > 0 && l.price > criteria.priceMax) return false;
        if (criteria.bedroomsMin != null && l.bedrooms != null && l.bedrooms < criteria.bedroomsMin) return false;
      }
    }

    // 3. Bedrooms below minimum → hard discard (known value only)
    if (criteria.bedroomsMin != null && l.bedrooms != null && l.bedrooms < criteria.bedroomsMin) return false;
    // 4. Bedrooms above maximum → hard discard (known value only)
    if (criteria.bedroomsMax != null && l.bedrooms != null && l.bedrooms > criteria.bedroomsMax) return false;

    // 5. Area below minimum → hard discard (known value only)
    if (criteria.areaMin != null && l.areaSqm != null && l.areaSqm < criteria.areaMin) return false;

    // 6. Price below minimum → hard discard (known value only)
    if (criteria.priceMin != null && l.price > 0 && l.price < criteria.priceMin) return false;

    // 7. Price more than 20% above maximum → hard discard (tightened from 30%)
    if (criteria.priceMax != null && l.price > 0 && l.price > criteria.priceMax * 1.2) return false;

    // 8. Neighborhood: discard listings from a known different neighborhood.
    //    Listings with no neighborhood data pass (benefit of the doubt).
    if (!neighborhoodOk(l, criteria)) return false;

    return true;
  });
}

// ---------------------------------------------------------------------------
// Geocoding enrichment
// ---------------------------------------------------------------------------

async function enrichWithGeo(listings: NormalizedListing[]): Promise<NormalizedListing[]> {
  const results: NormalizedListing[] = [];

  for (const listing of listings) {
    if (listing.lat && listing.lng && listing.geohash7) {
      results.push(listing);
      continue;
    }

    // Only geocode if we have a meaningful address
    if (!listing.address || listing.address.length < 5) {
      results.push(listing);
      continue;
    }

    const coords = await geocode(listing.address, listing.city, listing.state);

    if (coords) {
      const ngeohash = await import('ngeohash');
      results.push({
        ...listing,
        lat: coords.lat,
        lng: coords.lng,
        geohash7: ngeohash.encode(coords.lat, coords.lng, 7),
      });
    } else {
      results.push(listing);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Persist to DB
// ---------------------------------------------------------------------------

async function persistResults(
  briefingId: string,
  scored: Array<{ listing: NormalizedListing; score: number; scoreBreakdown: Record<string, unknown> }>,
  autoWiden: boolean,
): Promise<void> {
  // Clear previous results for this briefing (re-run scenario)
  await prisma.briefingResult.deleteMany({ where: { briefingId } });

  // Track property IDs already written for this briefing to avoid PK (briefingId, propertyId) conflicts.
  // When two scraped listings resolve to the same canonical property, keep the first (highest-ranked) one.
  const seenPropertyIds = new Set<string>();
  let effectiveRank = 0;

  for (let i = 0; i < scored.length; i++) {
    const { listing, score, scoreBreakdown } = scored[i]!;

    // Upsert canonical property using the unique (geohash7, address_normalized) constraint.
    // When geohash7 is null (ungeocoded), we always create — two ungeocoded rows with the
    // same address_normalized won't violate the partial unique index (NULLs are distinct).
    const addressNorm = normalizeAddress(listing.address);
    const propertyData = {
      addressNormalized: addressNorm,
      geohash7: listing.geohash7,
      neighborhood: listing.neighborhood || null,
      city: listing.city,
      state: listing.state,
      propertyType: mapPropertyType(listing.propertyType),
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      areaSqm: listing.areaSqm != null ? String(listing.areaSqm) : undefined,
      parkingSpots: listing.parkingSpots,
      price: String(listing.price),
      priceType: listing.priceType,
      furnished: listing.furnished,
      amenities: listing.amenities,
      extractedAmenities: listing.extractedAmenities,
      lastSeenAt: new Date(),
    };

    let property: { id: string };

    if (listing.geohash7) {
      // Service-level dedup: find by (geohash7, addressNormalized) then update-or-create.
      // A DB-level unique constraint was removed (migration 20260514000002) because it
      // merged different apartments in the same building when the address lacks a unit suffix.
      const existing = await prisma.property.findFirst({
        where: { geohash7: listing.geohash7, addressNormalized: addressNorm },
        select: { id: true },
      });
      if (existing) {
        property = await prisma.property.update({
          where: { id: existing.id },
          data: {
            price: String(listing.price),
            lastSeenAt: new Date(),
            amenities: listing.amenities,
            extractedAmenities: listing.extractedAmenities,
          },
          select: { id: true },
        });
      } else {
        property = await prisma.property.create({
          data: propertyData,
          select: { id: true },
        });
      }
    } else {
      property = await prisma.property.create({
        data: propertyData,
        select: { id: true },
      });
    }

    // Skip duplicate property for this briefing (same canonical property matched twice)
    if (seenPropertyIds.has(property.id)) continue;
    seenPropertyIds.add(property.id);
    effectiveRank++;

    // Upsert property source
    await prisma.propertySource_.upsert({
      where: {
        source_externalId: {
          source: listing.source,
          externalId: listing.externalId,
        },
      },
      create: {
        propertyId: property.id,
        source: listing.source,
        externalId: listing.externalId,
        url: listing.url,
        title: listing.title,
        description: listing.description,
        photos: listing.photos,
        rawPrice: String(listing.price),
        rawData: { amenities: listing.amenities, lat: listing.lat, lng: listing.lng },
        scrapedAt: new Date(),
      },
      update: {
        propertyId: property.id,
        rawPrice: String(listing.price),
        scrapedAt: new Date(),
        description: listing.description,
        photos: listing.photos,
      },
    });

    // Create briefing result
    await prisma.briefingResult.create({
      data: {
        briefingId,
        propertyId: property.id,
        fitScore: score,
        scoreBreakdown: scoreBreakdown as object,
        rank: effectiveRank,
        autoWidenUsed: autoWiden,
      },
    });
  }
}

function mapPropertyType(
  type: string,
): 'apartment' | 'house' | 'studio' | 'penthouse' | 'commercial' | 'warehouse' | 'land' | 'other' {
  const map: Record<string, 'apartment' | 'house' | 'studio' | 'penthouse' | 'commercial' | 'warehouse' | 'land' | 'other'> = {
    // English
    apartment: 'apartment', house: 'house', studio: 'studio',
    penthouse: 'penthouse', commercial: 'commercial', warehouse: 'warehouse', land: 'land',
    // Portuguese synonyms
    apartamento: 'apartment', casa: 'house', estudio: 'studio', kitnet: 'studio', flat: 'studio',
    cobertura: 'penthouse', comercial: 'commercial', galpao: 'warehouse', terreno: 'land',
    'casa de condominio': 'house', sobrado: 'house', loft: 'studio',
  };
  return map[type.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()] ?? 'other';
}
