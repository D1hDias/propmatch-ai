import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { cancelDeletion } from '@/server/lgpd/service';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError } from '@/server/lib/response';

const cancelSchema = z.object({
  cancellation_token: z.string().min(1),
});

// POST /api/v1/lgpd/delete/cancel
// Authenticated. Cancels a pending deletion within the 7-day grace period.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const body: unknown = await req.json();
    const parsed = cancelSchema.safeParse(body);

    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Missing cancellation_token',
        'Token de cancelamento é obrigatório.',
        400,
        { field_errors: parsed.error.flatten().fieldErrors },
      );
    }

    await cancelDeletion(ctx.sub, parsed.data.cancellation_token);
    return apiSuccess({ ok: true, message: 'Solicitação de exclusão cancelada com sucesso.' });
  } catch (err) {
    return apiError(err);
  }
}
