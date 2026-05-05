import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/auth/context';
import { prisma } from '@/server/db/client';
import { apiSuccess, apiError } from '@/server/lib/response';
import { AppError } from '@/server/lib/errors';
import { searchQueue } from '@/server/search/queue';

// POST /api/v1/briefings/{id}/widen
//
// Re-runs the search with a widened set of criteria chosen by the broker.
// Body: { criteria: SearchCriteria }  — one of the WidenProposal.criteria objects
// Sets autoWiden: true so the pipeline skips further auto-widen proposals.

const bodySchema = z.object({
  criteria: z.record(z.unknown()),
});

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

    const body = bodySchema.parse(await req.json());

    // Reset status so SSE stream starts polling again
    await prisma.briefing.update({
      where: { id },
      data: { status: 'searching' },
    });

    const job = await searchQueue.add('search', {
      briefingId: id,
      userId: ctx.sub,
      criteria: body.criteria,
      autoWiden: true,
    });

    return apiSuccess({ jobId: job.id, status: 'searching' }, 202);
  } catch (err) {
    return apiError(err);
  }
}
