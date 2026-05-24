import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { withRlsContext } from '@/server/db/client';
import { createBriefingSchema } from '@/lib/schemas/briefing';
import { createBriefing } from '@/server/briefings/service';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

// PRD §7.3: concurrent search limits per plan (Free=1, Starter=3, Pro=10)
const CONCURRENCY_LIMITS: Record<string, number> = { free: 1, starter: 3, pro: 10 };

// POST /api/v1/briefings
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const body: unknown = await req.json();
    const parsed = createBriefingSchema.safeParse(body);

    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Invalid briefing input',
        'Verifique o texto do briefing e tente novamente.',
        400,
        { field_errors: parsed.error.flatten().fieldErrors },
      );
    }

    // Concurrency cap — count briefings currently in 'searching' state for this user
    const limit = CONCURRENCY_LIMITS[ctx.plan] ?? 1;
    const activeSearches = await withRlsContext(ctx.sub, ctx.role, (tx) =>
      tx.briefing.count({ where: { userId: ctx.sub, status: 'searching' } }),
    );
    if (activeSearches >= limit) {
      throw new AppError(
        'CONCURRENCY_EXCEEDED',
        `User ${ctx.sub} already has ${activeSearches} active searches (limit: ${limit})`,
        `Você já tem ${activeSearches} busca${activeSearches > 1 ? 's' : ''} rodando. Aguarde uma terminar para iniciar outra.`,
        429,
      );
    }

    const briefingId = await createBriefing(ctx.sub, ctx.role, parsed.data);
    return apiSuccess({ id: briefingId, status: 'extracting' }, 202);
  } catch (err) {
    return apiError(err);
  }
}

// GET /api/v1/briefings?page=1&per_page=20
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('per_page') ?? '20', 10)));

    const result = await withRlsContext(ctx.sub, ctx.role, async (tx) => {
      const skip = (page - 1) * perPage;
      const [items, total] = await Promise.all([
        tx.briefing.findMany({
          where: { userId: ctx.sub },
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
        tx.briefing.count({ where: { userId: ctx.sub } }),
      ]);
      return { items, total, page, perPage };
    });
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
