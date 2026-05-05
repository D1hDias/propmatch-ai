import type { NextRequest } from 'next/server';
import { runRetentionJob } from '@/server/jobs/retention';
import { apiSuccess, apiError } from '@/server/lib/response';
import { AppError } from '@/server/lib/errors';

// POST /api/v1/internal/cron/retention
//
// Called by the systemd timer (or Vercel cron) daily at 03:00 UTC.
// Protected by CRON_SECRET header — never expose this route publicly.
//
// Systemd unit example (infra/systemd/propmatch-retention.timer):
//   [Timer]
//   OnCalendar=*-*-* 03:00:00 UTC
//   Persistent=true
//
// Corresponding service calls:
//   curl -s -X POST https://app.propmatch.com.br/api/v1/internal/cron/retention \
//        -H "Authorization: Bearer $CRON_SECRET"
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      throw new AppError(
        'INTERNAL_ERROR',
        'CRON_SECRET env var not configured',
        'Erro de configuração do servidor.',
        500,
      );
    }

    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      throw new AppError(
        'INSUFFICIENT_PERMISSIONS',
        'Invalid or missing cron secret',
        'Não autorizado.',
        403,
      );
    }

    const result = await runRetentionJob();
    return apiSuccess({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
