import 'server-only';
import { Queue, Worker, type Job } from 'bullmq';
import { logger } from '@/server/lib/logger';
import { prisma } from '@/server/db/client';
import { runSearch } from './run-search';
import { deduplicate } from './dedup';
import { scoreAndSort } from './fit-score';
import { geocode } from './geocoder';
import { normalizeAddress } from './normalize-address';
import { proposeWidens, AUTO_WIDEN_THRESHOLD } from './auto-widen';
import type { SearchCriteria, NormalizedListing } from './types';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

function redisConnection() {
  const url = new URL(REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
  };
}

const connection = redisConnection();

export const searchQueue = new Queue('search', { connection });

export interface SearchJobData {
  briefingId: string;
  userId: string;
  criteria: unknown;
  portals?: string[];    // preset portals selected by broker (e.g. ['zap','vivareal'])
  customUrls?: string[]; // arbitrary imobiliária URLs provided by broker
  autoWiden?: boolean;   // true when this is a widen re-run
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
      const { briefingId, criteria: rawCriteria, portals, customUrls, autoWiden = false } = job.data;
      const criteria = rawCriteria as SearchCriteria;

      logger.info('search job started', { briefingId, jobId: job.id, autoWiden, portals, customUrlCount: customUrls?.length ?? 0 });

      try {
        // 1. Fan-out scraping (preset portals + custom URLs)
        const { listings: raw, sourceErrors, customUrlResults, durationMs } = await runSearch(criteria, { portals, customUrls });

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

        // 5. Score and rank
        const scored = scoreAndSort(preFiltered, criteria);

        // 6. Apply minimum score cutoff — only keep listings with meaningful match
        const MIN_SCORE = 45;
        const qualified = scored.filter((s) => s.score >= MIN_SCORE);
        logger.info('score cutoff', {
          threshold: MIN_SCORE,
          before: scored.length,
          after: qualified.length,
          briefingId,
        });

        // 7. Persist properties + briefing_results
        await persistResults(briefingId, qualified, autoWiden);

        // 8. Auto-widen check — if results < 5 and this was not already a widen
        const widenProposals =
          !autoWiden && qualified.length < AUTO_WIDEN_THRESHOLD
            ? proposeWidens(criteria, qualified.length)
            : [];

        // Update briefing status.
        // Preserve the original extractedCriteria (SearchCriteria camelCase); only
        // append metadata keys so re-search never sees null criteria.
        const metaUpdate = widenProposals.length > 0 || customUrlResults.length > 0;
        if (metaUpdate) {
          const current = await prisma.briefing.findUnique({
            where: { id: briefingId },
            select: { extractedCriteria: true },
          });
          const merged = {
            ...(current?.extractedCriteria as Record<string, unknown> ?? {}),
            ...(widenProposals.length > 0 ? { _widenProposals: widenProposals as unknown[] } : {}),
            ...(customUrlResults.length > 0 ? { _customUrlResults: customUrlResults } : {}),
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
          results: scored.length,
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

function hardFilter(listings: NormalizedListing[], criteria: SearchCriteria): NormalizedListing[] {
  return listings.filter((l) => {
    // Bedrooms below minimum → hard discard (known value only)
    if (criteria.bedroomsMin != null && l.bedrooms != null && l.bedrooms < criteria.bedroomsMin) {
      return false;
    }
    // Bedrooms above maximum → hard discard (known value only)
    if (criteria.bedroomsMax != null && l.bedrooms != null && l.bedrooms > criteria.bedroomsMax) {
      return false;
    }

    // Area below minimum → hard discard (known value only)
    if (criteria.areaMin != null && l.areaSqm != null && l.areaSqm < criteria.areaMin) {
      return false;
    }

    // Price more than 30% above maximum → hard discard (known value only)
    if (criteria.priceMax != null && l.price > 0 && l.price > criteria.priceMax * 1.3) {
      return false;
    }

    // Neighborhood: discard listings from a known different neighborhood.
    // Listings with no neighborhood data pass (we don't want to over-filter on missing data).
    if (!neighborhoodOk(l, criteria)) {
      return false;
    }

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
  scored: Array<{ listing: NormalizedListing; score: number; scoreBreakdown: Record<string, number> }>,
  autoWiden: boolean,
): Promise<void> {
  // Clear previous results for this briefing (re-run scenario)
  await prisma.briefingResult.deleteMany({ where: { briefingId } });

  for (let i = 0; i < scored.length; i++) {
    const { listing, score, scoreBreakdown } = scored[i]!;

    // Upsert canonical property
    const addressNorm = normalizeAddress(listing.address);
    const property = await prisma.property.upsert({
      where: {
        // Use a unique constraint on (geohash7, address_normalized) — added via raw for now
        // Sprint 4 migration adds a proper unique index; for now upsert on id is a create
        id: '00000000-0000-0000-0000-000000000000', // force create path
      } as never,
      create: {
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
      },
      update: {
        price: String(listing.price),
        lastSeenAt: new Date(),
        amenities: listing.amenities,
        extractedAmenities: listing.extractedAmenities,
        geohash7: listing.geohash7,
      },
    });

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
        scoreBreakdown,
        rank: i + 1,
        autoWidenUsed: autoWiden,
      },
    });
  }
}

function mapPropertyType(
  type: string,
): 'apartment' | 'house' | 'studio' | 'penthouse' | 'commercial' | 'warehouse' | 'land' | 'other' {
  const map: Record<string, 'apartment' | 'house' | 'studio' | 'penthouse' | 'commercial' | 'warehouse' | 'land' | 'other'> = {
    apartment: 'apartment', house: 'house', studio: 'studio',
    penthouse: 'penthouse', commercial: 'commercial', warehouse: 'warehouse', land: 'land',
  };
  return map[type.toLowerCase()] ?? 'other';
}
