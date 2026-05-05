import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { requestDeletion } from '@/server/lgpd/service';
import { apiSuccess, apiError } from '@/server/lib/response';

// POST /api/v1/lgpd/delete
// Authenticated. Creates a deletion job with a 7-day cancellation window.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const result = await requestDeletion(ctx.sub);

    return apiSuccess({
      job_id: result.jobId,
      cancellation_token: result.cancellationToken,
      grace_period_ends_at: result.gracePeriodEndsAt.toISOString(),
      message:
        'Solicitação de exclusão recebida. Você tem 7 dias para cancelar antes que a conta seja excluída permanentemente.',
    });
  } catch (err) {
    return apiError(err);
  }
}
