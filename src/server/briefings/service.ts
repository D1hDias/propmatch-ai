import 'server-only';
import { prisma, withRlsContext } from '@/server/db/client';
import type { Prisma } from '@prisma/client';
import { extractBriefing } from './extract';
import { toSearchCriteria } from './criteria-transform';
import { hitlQueue } from './hitl-queue';
import { searchQueue } from '@/server/search/queue';
import { logger } from '@/server/lib/logger';
import type { CreateBriefingInput } from '@/lib/schemas/briefing';
import type { SearchCriteria } from '@/server/search/types';

// PRD §6.3 US-01 AC3: auto-approve threshold and low-confidence band (0.80–0.85)
const CONFIDENCE_AUTO_APPROVE = 0.85;
const CONFIDENCE_LOW_CONFIDENCE = 0.80; // below this → HITL (or overflow broker edit)

// PRD §5.6: overflow when queue p95 exceeds 10min — use waiting count as proxy
const HITL_OVERFLOW_THRESHOLD = 50;

/**
 * Creates a briefing, persists it, then runs LLM extraction in the background.
 * Returns the briefing ID immediately so the client can poll/stream status.
 * Uses withRlsContext so Postgres RLS policies apply to the INSERT (ADR-0005).
 */
export async function createBriefing(
  userId: string,
  userRole: string,
  input: CreateBriefingInput,
): Promise<string> {
  const purgeAt = new Date(Date.now() + 18 * 30 * 24 * 60 * 60 * 1000); // ~18 months

  const briefing = await withRlsContext(userId, userRole, async (tx) => {
    const clientId = input.client_id ?? await createGuestClient(userId, tx);
    return tx.briefing.create({
      data: {
        userId,
        clientId,
        rawText: input.raw_text,
        rawTextPurgeAt: purgeAt,
        selectedPortals: input.partner_site_ids ?? [],
        customUrls: input.custom_urls ?? [],
        status: 'extracting',
        reviewStatus: 'pending',
      },
    });
  });

  // When structured_criteria is provided (Categories tab), bypass LLM extraction
  // and go directly to search — the user already specified all criteria explicitly.
  if (input.structured_criteria) {
    void runDirectSearch(briefing.id, input.structured_criteria, briefing.customUrls as string[], briefing.selectedPortals as string[]);
  } else {
    // Fire-and-forget extraction — does not block the HTTP response
    void runExtraction(briefing.id, input.raw_text, briefing.customUrls as string[], briefing.selectedPortals as string[]);
  }

  return briefing.id;
}

/**
 * Direct search path for Categories tab — skips LLM extraction entirely.
 * Maps the structured form criteria straight into a SearchCriteria and enqueues the job.
 */
async function runDirectSearch(
  briefingId: string,
  sc: NonNullable<CreateBriefingInput['structured_criteria']>,
  customUrls: string[],
  partnerSiteIds: string[],
): Promise<void> {
  try {
    const criteria: SearchCriteria = {
      purpose: sc.purpose === 'rent' ? 'rent' : 'buy',
      city: sc.city ?? 'Rio de Janeiro',
      state: 'RJ',
      neighborhoods: sc.neighborhoods ?? [],
      neighborhood: sc.neighborhoods?.[0] ?? null,
      propertyType: sc.property_types?.[0] ?? null,
      priceMin: sc.price_min ?? null,
      priceMax: sc.price_max ?? null,
      bedroomsMin: sc.bedrooms_min ?? null,
      areaMin: sc.area_min ?? null,
      areaMax: sc.area_max ?? null,
      parkingMin: sc.parking_min ?? null,
    };

    const userId = (await prisma.briefing.findUniqueOrThrow({
      where: { id: briefingId },
      select: { userId: true },
    })).userId;

    await prisma.briefing.update({
      where: { id: briefingId },
      data: {
        extractedCriteria: criteria as unknown as object,
        extractionConfidence: 1.0,
        reviewStatus: 'not_required',
        reviewMode: 'auto_approved',
        status: 'searching',
      },
    });

    await searchQueue.add('search', {
      briefingId,
      userId,
      criteria,
      customUrls,
      partnerSiteIds,
    });

    logger.info('briefing_direct_search_queued', { briefingId, neighborhoods: criteria.neighborhoods });
  } catch (err) {
    logger.error('briefing_direct_search_failed', {
      briefingId,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    await prisma.briefing.update({
      where: { id: briefingId },
      data: { status: 'failed' },
    });
  }
}

/**
 * Runs LLM extraction and updates the briefing row with the results.
 * If extraction is auto-approved, immediately enqueues the search job.
 * Called asynchronously after createBriefing returns.
 */
async function runExtraction(
  briefingId: string,
  rawText: string,
  customUrls: string[],
  partnerSiteIds: string[] = [],
): Promise<void> {
  try {
    const result = await extractBriefing(rawText);

    const hasCritical = result.missingCriticalFields.length === 0;
    const confidence = result.confidence;

    logger.info('briefing_extraction_complete', {
      briefingId,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      confidence,
      missingCriticalFields: result.missingCriticalFields,
      durationMs: result.durationMs,
      city: result.criteria.location?.city,
      neighborhoods: result.criteria.location?.neighborhoods,
    });

    let reviewStatus: 'not_required' | 'pending' | 'approved' | 'overflow_broker_edit';
    let reviewMode: 'auto_approved' | 'hitl' | 'broker_direct_edit' | null;

    if (!hasCritical || confidence < CONFIDENCE_LOW_CONFIDENCE) {
      // Check HITL queue depth — PRD §5.6 overflow rules
      const queueDepth = await hitlQueue.getWaitingCount();
      const isOverflow = queueDepth >= HITL_OVERFLOW_THRESHOLD;

      if (isOverflow) {
        // Tier 2 overflow: surface directly to broker for editing (PRD §5.6 Tier 2)
        reviewStatus = 'overflow_broker_edit';
        reviewMode = 'broker_direct_edit';
        logger.warn('hitl_overflow_broker_direct_edit', { briefingId, queueDepth, confidence });

        await prisma.briefing.update({
          where: { id: briefingId },
          data: {
            extractedCriteria: result.criteria as object,
            extractionConfidence: result.confidence,
            reviewStatus,
            reviewMode,
            status: 'ready',
          },
        });
      } else {
        // Normal HITL path
        reviewStatus = 'pending';
        reviewMode = 'hitl';

        await prisma.hitlMetric.create({ data: { briefingId } });
        await hitlQueue.add('review', {
          briefingId,
          userId: (await prisma.briefing.findUniqueOrThrow({ where: { id: briefingId }, select: { userId: true } })).userId,
          confidence,
          missingFields: result.missingCriticalFields,
        });

        await prisma.briefing.update({
          where: { id: briefingId },
          data: {
            extractedCriteria: result.criteria as object,
            extractionConfidence: result.confidence,
            reviewStatus,
            reviewMode,
            status: 'ready',
          },
        });
      }
    } else {
      // Auto-approved: start search immediately
      reviewStatus = confidence >= CONFIDENCE_AUTO_APPROVE ? 'not_required' : 'approved';
      reviewMode = 'auto_approved';

      await prisma.briefing.update({
        where: { id: briefingId },
        data: {
          extractedCriteria: result.criteria as object,
          extractionConfidence: result.confidence,
          reviewStatus,
          reviewMode,
          status: 'searching',
        },
      });

      await searchQueue.add('search', {
        briefingId,
        userId: (await prisma.briefing.findUniqueOrThrow({ where: { id: briefingId }, select: { userId: true } })).userId,
        criteria: toSearchCriteria(result.criteria),
        customUrls,
        partnerSiteIds,
      });
    }
  } catch (err) {
    logger.error('briefing_extraction_failed', {
      briefingId,
      error: err instanceof Error ? err : new Error(String(err)),
      message: err instanceof Error ? err.message : String(err),
    });
    await prisma.briefing.update({
      where: { id: briefingId },
      data: { status: 'failed' },
    });
  }
}

/**
 * Returns a briefing by ID, enforcing that it belongs to the requesting user.
 * RLS at the DB level backs this up, but explicit userId check is defence-in-depth.
 */
export async function getBriefing(briefingId: string, userId: string) {
  return prisma.briefing.findFirst({
    where: { id: briefingId, userId },
    include: {
      hitlMetrics: { orderBy: { queuedAt: 'desc' }, take: 1 },
      client: {
        select: { id: true, name: true, isGuest: true, createdAt: true, softArchivedAt: true },
      },
    },
  });
}

/**
 * Lists briefings for the authenticated user, newest first.
 */
export async function listBriefings(userId: string, page = 1, perPage = 20) {
  const skip = (page - 1) * perPage;
  const [items, total] = await Promise.all([
    prisma.briefing.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: perPage,
      select: {
        id: true,
        rawText: true,
        status: true,
        reviewStatus: true,
        extractionConfidence: true,
        createdAt: true,
        clientId: true,
      },
    }),
    prisma.briefing.count({ where: { userId } }),
  ]);
  return { items, total, page, perPage };
}

async function createGuestClient(userId: string, tx: Prisma.TransactionClient): Promise<string> {
  const today = new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const client = await tx.client.create({
    data: {
      userId,
      name: `Guest – ${today}`,
      isGuest: true,
    },
  });
  return client.id;
}
