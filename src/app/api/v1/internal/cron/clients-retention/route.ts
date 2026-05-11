import type { NextRequest } from 'next/server';
import { runClientRetentionJob } from '@/server/jobs/clients-retention';
import { logger } from '@/server/lib/logger';

export const dynamic = 'force-dynamic';

// POST /api/v1/internal/cron/clients-retention
// Protected by CRON_SECRET header. Triggered nightly by systemd timer (03:15 UTC).
// Runs OPS-3, OPS-4, OPS-5, OPS-6.

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await runClientRetentionJob();
    logger.info('clients retention cron complete', result as unknown as Record<string, unknown>);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    logger.error('clients retention cron failed', { error: err });
    return Response.json({ ok: false }, { status: 500 });
  }
}
