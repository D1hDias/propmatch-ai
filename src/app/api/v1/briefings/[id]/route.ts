import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { getBriefing } from '@/server/briefings/service';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError } from '@/server/lib/response';

// GET /api/v1/briefings/:id
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;

    const briefing = await getBriefing(id, ctx.sub);

    if (!briefing) {
      throw new AppError(
        'RESOURCE_NOT_FOUND',
        `Briefing ${id} not found`,
        'Briefing não encontrado.',
        404,
      );
    }

    return apiSuccess(briefing);
  } catch (err) {
    return apiError(err);
  }
}
