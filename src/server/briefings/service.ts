import 'server-only';
import { prisma } from '@/server/db/client';
import { extractBriefing } from './extract';
import { hitlQueue } from './hitl-queue';
import type { CreateBriefingInput } from '@/lib/schemas/briefing';

const CONFIDENCE_AUTO_APPROVE = 0.85;
const CONFIDENCE_AUTO_APPROVE_WITH_OVERRIDE = 0.80;

/**
 * Creates a briefing, persists it, then runs LLM extraction in the background.
 * Returns the briefing ID immediately so the client can poll/stream status.
 */
export async function createBriefing(
  userId: string,
  input: CreateBriefingInput,
): Promise<string> {
  const purgeAt = new Date(Date.now() + 18 * 30 * 24 * 60 * 60 * 1000); // ~18 months

  // Resolve clientId — if none provided, create a guest client automatically
  const clientId = input.client_id ?? await createGuestClient(userId);

  const briefing = await prisma.briefing.create({
    data: {
      userId,
      clientId,
      rawText: input.raw_text,
      rawTextPurgeAt: purgeAt,
      selectedPortals: input.portals ?? ['zap', 'vivareal'],
      customUrls: input.custom_urls ?? [],
      status: 'extracting',
      reviewStatus: 'pending',
    },
  });

  // Fire-and-forget extraction — does not block the HTTP response
  void runExtraction(briefing.id, input.raw_text);

  return briefing.id;
}

/**
 * Runs LLM extraction and updates the briefing row with the results.
 * Called asynchronously after createBriefing returns.
 */
async function runExtraction(briefingId: string, rawText: string): Promise<void> {
  try {
    const result = await extractBriefing(rawText);

    const hasCritical = result.missingCriticalFields.length === 0;
    const confidence = result.confidence;

    let reviewStatus: 'not_required' | 'pending' | 'approved';
    let reviewMode: 'auto_approved' | 'hitl' | null;

    if (!hasCritical || confidence < CONFIDENCE_AUTO_APPROVE_WITH_OVERRIDE) {
      // Route to HITL
      reviewStatus = 'pending';
      reviewMode = 'hitl';

      await prisma.hitlMetric.create({ data: { briefingId } });
      await hitlQueue.add('review', {
        briefingId,
        userId: (await prisma.briefing.findUniqueOrThrow({ where: { id: briefingId }, select: { userId: true } })).userId,
        confidence,
        missingFields: result.missingCriticalFields,
      });
    } else if (confidence >= CONFIDENCE_AUTO_APPROVE) {
      reviewStatus = 'not_required';
      reviewMode = 'auto_approved';
    } else {
      // 0.80–0.85: auto-approved but flagged
      reviewStatus = 'approved';
      reviewMode = 'auto_approved';
    }

    await prisma.briefing.update({
      where: { id: briefingId },
      data: {
        extractedCriteria: result.criteria,
        extractionConfidence: result.confidence,
        reviewStatus,
        reviewMode: reviewMode ?? undefined,
        status: 'ready',
      },
    });
  } catch {
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

async function createGuestClient(userId: string): Promise<string> {
  const today = new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const client = await prisma.client.create({
    data: {
      userId,
      name: `Guest – ${today}`,
      isGuest: true,
    },
  });
  return client.id;
}
