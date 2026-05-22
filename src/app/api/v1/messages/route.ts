import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { withRlsContext } from '@/server/db/client';
import { apiSuccess, apiError } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

// GET /api/v1/messages?page=1&per_page=20
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('per_page') ?? '20', 10)));

    const result = await withRlsContext(ctx.sub, ctx.role, async (tx) => {
      const skip = (page - 1) * perPage;
      const [items, total] = await Promise.all([
        tx.message.findMany({
          where: { briefing: { userId: ctx.sub } },
          orderBy: { createdAt: 'desc' },
          skip,
          take: perPage,
          select: {
            id: true,
            briefingId: true,
            clientId: true,
            formattedText: true,
            deliveryMethod: true,
            deliveryStatus: true,
            createdAt: true,
            client: { select: { id: true, name: true } },
            briefing: { select: { id: true, rawText: true } },
          },
        }),
        tx.message.count({ where: { briefing: { userId: ctx.sub } } }),
      ]);
      return { items, total, page, perPage };
    });

    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
