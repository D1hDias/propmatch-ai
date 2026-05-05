import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { prisma } from '@/server/db/client';
import { apiSuccess, apiError } from '@/server/lib/response';
import { AppError } from '@/server/lib/errors';
import { searchQueue } from '@/server/search/queue';

// POST /api/v1/briefings/{id}/search
//
// Enqueues a search job for the briefing. Returns immediately with the job ID.
// The client polls GET /api/v1/briefings/{id}/stream (SSE) for results.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;

    const briefing = await prisma.briefing.findFirst({
      where: { id, userId: ctx.sub },
    });

    if (!briefing) {
      throw new AppError(
        'RESOURCE_NOT_FOUND',
        `Briefing ${id} not found`,
        'Briefing não encontrado.',
        404,
      );
    }

    if (!briefing.extractedCriteria) {
      throw new AppError(
        'BRIEFING_EXTRACTION_FAILED',
        'Briefing has no extracted criteria — run extraction first',
        'A extração do briefing ainda não foi concluída.',
        422,
      );
    }

    // Update status to searching
    await prisma.briefing.update({
      where: { id },
      data: { status: 'searching' },
    });

    // Enqueue the search job (BullMQ)
    const job = await searchQueue.add('search', {
      briefingId: id,
      userId: ctx.sub,
      criteria: briefing.extractedCriteria,
    });

    return apiSuccess({ jobId: job.id, status: 'searching' }, 202);
  } catch (err) {
    return apiError(err);
  }
}
