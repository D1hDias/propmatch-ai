import { prisma } from '@/server/db/client';
import { apiSuccess, apiError } from '@/server/lib/response';
import { AppError } from '@/server/lib/errors';

// GET /api/v1/internal/health
//
// Uptime monitor endpoint — polled by BetterStack every minute.
// Verifies DB connectivity. Returns 200 if healthy, 503 if degraded.
// No auth required; no sensitive data in response.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return apiSuccess({ ok: true, db: 'up', ts: new Date().toISOString() });
  } catch (err) {
    throw new AppError(
      'INTERNAL_ERROR',
      `Health check DB failure: ${String(err)}`,
      'Serviço temporariamente indisponível.',
      503,
    );
  }
}
