import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { withRlsContext } from '@/server/db/client';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

// GET /api/v1/briefings/:id
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;

    const briefing = await withRlsContext(ctx.sub, ctx.role, (tx) =>
      tx.briefing.findFirst({
        where: { id, userId: ctx.sub },
        include: {
          hitlMetrics: { orderBy: { queuedAt: 'desc' }, take: 1 },
          client: {
            select: { id: true, name: true, isGuest: true, createdAt: true, softArchivedAt: true },
          },
        },
      }),
    );

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
