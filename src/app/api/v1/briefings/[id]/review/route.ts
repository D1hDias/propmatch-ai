import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/auth/context';
import { prisma } from '@/server/db/client';
import { apiSuccess, apiError } from '@/server/lib/response';
import { AppError } from '@/server/lib/errors';

export const dynamic = 'force-dynamic';

// PATCH /api/v1/briefings/{id}/review
//
// Admin-only endpoint: resolve a HITL review.
// Outcomes:
//   - approved:   accept extractedCriteria as-is
//   - corrected:  replace extractedCriteria with the submitted correction
//   - overflow_redirect: mark as overflow (broker takes over)

const bodySchema = z.object({
  outcome: z.enum(['approved', 'corrected', 'overflow_redirect']),
  correctedCriteria: z.record(z.unknown()).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;

    if (ctx.role !== 'admin') {
      throw new AppError(
        'INSUFFICIENT_PERMISSIONS',
        'Only admins can resolve HITL reviews',
        'Acesso negado.',
        403,
      );
    }

    const briefing = await prisma.briefing.findUnique({ where: { id } });
    if (!briefing) {
      throw new AppError('RESOURCE_NOT_FOUND', `Briefing ${id} not found`, 'Briefing não encontrado.', 404);
    }

    if (briefing.reviewStatus !== 'pending') {
      throw new AppError(
        'RESOURCE_CONFLICT',
        'Briefing is not pending review',
        'Este briefing não está aguardando revisão.',
        409,
      );
    }

    const body = bodySchema.parse(await req.json());
    const now = new Date();

    // Resolve the briefing
    await prisma.briefing.update({
      where: { id },
      data: {
        reviewStatus: body.outcome === 'approved'
          ? 'approved'
          : body.outcome === 'corrected'
          ? 'corrected'
          : 'overflow_broker_edit',
        reviewMode: 'hitl',
        reviewedBy: ctx.sub,
        ...(body.outcome === 'corrected' && body.correctedCriteria
          ? { extractedCriteria: body.correctedCriteria as Parameters<typeof prisma.briefing.update>[0]['data']['extractedCriteria'] }
          : {}),
      },
    });

    // Record resolution in HitlMetric
    const metric = await prisma.hitlMetric.findFirst({
      where: { briefingId: id },
      orderBy: { queuedAt: 'desc' },
    });

    if (metric) {
      await prisma.hitlMetric.update({
        where: { id: metric.id },
        data: {
          reviewedAt: now,
          reviewDurationMs: now.getTime() - metric.queuedAt.getTime(),
          reviewerId: ctx.sub,
          outcome: body.outcome === 'approved'
            ? 'approved'
            : body.outcome === 'corrected'
            ? 'corrected'
            : 'overflow_redirect',
        },
      });
    }

    return apiSuccess({ id, outcome: body.outcome });
  } catch (err) {
    return apiError(err);
  }
}
