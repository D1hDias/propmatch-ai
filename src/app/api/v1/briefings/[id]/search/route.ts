import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { withRlsContext } from '@/server/db/client';
import { apiSuccess, apiError } from '@/server/lib/response';
import { AppError } from '@/server/lib/errors';
import { searchQueue } from '@/server/search/queue';
import { toSearchCriteria } from '@/server/briefings/criteria-transform';
import type { ExtractedCriteria } from '@/server/briefings/extract';

export const dynamic = 'force-dynamic';

// PRD §7.3: concurrent search limits per plan
const CONCURRENCY_LIMITS: Record<string, number> = { free: 1, starter: 3, pro: 10 };

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

    const limit = CONCURRENCY_LIMITS[ctx.plan] ?? 1;

    const briefing = await withRlsContext(ctx.sub, ctx.role, async (tx) => {
      const b = await tx.briefing.findFirst({ where: { id, userId: ctx.sub } });
      if (!b) return null;

      // Concurrency cap — count other briefings already searching
      const activeSearches = await tx.briefing.count({
        where: { userId: ctx.sub, status: 'searching', NOT: { id } },
      });
      if (activeSearches >= limit) {
        throw new AppError(
          'CONCURRENCY_EXCEEDED',
          `User ${ctx.sub} already has ${activeSearches} active searches (limit: ${limit})`,
          `Você já tem ${activeSearches} busca${activeSearches > 1 ? 's' : ''} rodando. Aguarde uma terminar para iniciar outra.`,
          429,
        );
      }

      // Update status to searching
      await tx.briefing.update({ where: { id }, data: { status: 'searching' } });
      return b;
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

    // extractedCriteria is stored as ExtractedCriteria (nested LLM output). Convert to
    // SearchCriteria for the search pipeline.
    const criteria = toSearchCriteria(briefing.extractedCriteria as unknown as ExtractedCriteria);

    // Enqueue the search job (BullMQ)
    const job = await searchQueue.add('search', {
      briefingId: id,
      userId: ctx.sub,
      criteria,
      partnerSiteIds: briefing.selectedPortals,
      customUrls: briefing.customUrls,
    });

    return apiSuccess({ jobId: job.id, status: 'searching' }, 202);
  } catch (err) {
    return apiError(err);
  }
}
