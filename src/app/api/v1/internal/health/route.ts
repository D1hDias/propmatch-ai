import { prisma } from '@/server/db/client';
import { apiSuccess } from '@/server/lib/response';
import { AppError } from '@/server/lib/errors';
import { checkFirecrawlHealth } from '@/server/search/firecrawl-client';

export const dynamic = 'force-dynamic';

// GET /api/v1/internal/health
//
// Uptime monitor endpoint — polled by BetterStack every minute.
// Verifies DB connectivity and Firecrawl self-hosted reachability.
// Returns 200 if healthy, 503 if DB is down.
// Firecrawl degraded → 200 with firecrawl:'degraded' (non-critical).
// No auth required; no sensitive data in response.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    throw new AppError(
      'INTERNAL_ERROR',
      `Health check DB failure: ${String(err)}`,
      'Serviço temporariamente indisponível.',
      503,
    );
  }

  const firecrawl = await checkFirecrawlHealth();

  return apiSuccess({
    ok: true,
    db: 'up',
    firecrawl: firecrawl.healthy ? 'up' : 'degraded',
    ...(!firecrawl.healthy && { firecrawlError: (firecrawl as { error: string }).error }),
    ts: new Date().toISOString(),
  });
}
