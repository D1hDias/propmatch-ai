import 'server-only';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { requestExport } from '@/server/lgpd/export-service';
import { exportQueue } from '@/server/lgpd/export-queue';
import { apiSuccess, apiError } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

// POST /api/v1/lgpd/export
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);

    const { jobId } = await requestExport(ctx.sub);

    // Enqueue the async ZIP assembly
    await exportQueue.add('export', { jobId, userId: ctx.sub });

    return apiSuccess(
      {
        job_id: jobId,
        message:
          'Exportação iniciada. Você receberá um e-mail com o link para download em alguns minutos.',
      },
      202,
    );
  } catch (err) {
    return apiError(err);
  }
}

// GET /api/v1/lgpd/export — check status of the most recent export job
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);

    const { prisma } = await import('@/server/db/client');
    const job = await prisma.lgpdJob.findFirst({
      where: { userId: ctx.sub, jobType: 'export' },
      orderBy: { requestedAt: 'desc' },
      select: { id: true, status: true, requestedAt: true, completedAt: true },
    });

    if (!job) {
      return apiSuccess({ status: 'none' });
    }

    return apiSuccess({
      job_id: job.id,
      status: job.status,
      requested_at: job.requestedAt.toISOString(),
      completed_at: job.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    return apiError(err);
  }
}
