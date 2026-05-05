import 'server-only';
import { Queue, Worker, type Job } from 'bullmq';
import { logger } from '@/server/lib/logger';
import { prisma } from '@/server/db/client';
import { runSearch } from './run-search';
import type { SearchCriteria } from './types';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Parse Redis connection options from URL
function redisConnection() {
  const url = new URL(REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
  };
}

const connection = redisConnection();

// ---------------------------------------------------------------------------
// Queue definition
// ---------------------------------------------------------------------------

export const searchQueue = new Queue('search', { connection });

// ---------------------------------------------------------------------------
// Job payload type
// ---------------------------------------------------------------------------

export interface SearchJobData {
  briefingId: string;
  userId: string;
  criteria: unknown; // JSON from DB — cast to SearchCriteria in worker
}

// ---------------------------------------------------------------------------
// Worker — runs in the same Next.js process for MVP
// (move to separate service when traffic requires it)
// ---------------------------------------------------------------------------

let workerStarted = false;

export function startSearchWorker(): void {
  if (workerStarted) return;
  workerStarted = true;

  const worker = new Worker<SearchJobData>(
    'search',
    async (job: Job<SearchJobData>) => {
      const { briefingId, criteria } = job.data;

      logger.info('search job started', { briefingId, jobId: job.id });

      try {
        const { listings, sourceErrors, durationMs } = await runSearch(
          criteria as SearchCriteria,
        );

        // Persist listings to property_sources (dedup logic in Sprint 4)
        // For now we upsert by (source, externalId) — no dedup yet
        for (const listing of listings) {
          // Find or create canonical property
          const property = await prisma.property.upsert({
            where: {
              // Unique by source + externalId stored in property_sources
              // For now use a temporary key; Sprint 4 adds proper dedup
              id: undefined as unknown as string, // force create path
            } as never,
            create: {
              addressNormalized: listing.address.toLowerCase().trim(),
              geohash7: listing.geohash7,
              neighborhood: listing.neighborhood,
              city: listing.city,
              state: listing.state,
              propertyType: mapPropertyType(listing.propertyType),
              bedrooms: listing.bedrooms,
              bathrooms: listing.bathrooms,
              areaSqm: listing.areaSqm ? String(listing.areaSqm) : undefined,
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
              rawData: {
                amenities: listing.amenities,
                lat: listing.lat,
                lng: listing.lng,
                areaSqm: listing.areaSqm,
              },
              scrapedAt: new Date(),
            },
            update: {
              rawPrice: String(listing.price),
              scrapedAt: new Date(),
              description: listing.description,
              photos: listing.photos,
            },
          });
        }

        // Update briefing status
        await prisma.briefing.update({
          where: { id: briefingId },
          data: { status: 'ready' },
        });

        logger.info('search job complete', {
          briefingId,
          listings: listings.length,
          durationMs,
          sourceErrors,
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

function mapPropertyType(
  type: string,
): 'apartment' | 'house' | 'studio' | 'penthouse' | 'commercial' | 'warehouse' | 'land' | 'other' {
  const map: Record<string, 'apartment' | 'house' | 'studio' | 'penthouse' | 'commercial' | 'warehouse' | 'land' | 'other'> = {
    apartment: 'apartment',
    house: 'house',
    studio: 'studio',
    penthouse: 'penthouse',
    commercial: 'commercial',
    warehouse: 'warehouse',
    land: 'land',
  };
  return map[type.toLowerCase()] ?? 'other';
}
