import { apiSuccess } from '@/server/lib/response';
import { AppError } from '@/server/lib/errors';

export const dynamic = 'force-dynamic';

// GET /api/v1/internal/costs
//
// Proxies OpenRouter's /api/v1/key endpoint to expose daily/weekly/monthly
// LLM credit consumption without exposing the raw API key to the client.
// Intended for operational monitoring (BetterStack, admin dashboard).
// No user auth required — internal network only.
export async function GET() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new AppError('INTERNAL_ERROR', 'OPENROUTER_API_KEY not set', 'Configuração inválida.', 500);
  }

  const res = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 60 }, // cache 60 s — avoids hammering OpenRouter on every health poll
  });

  if (!res.ok) {
    throw new AppError(
      'INTERNAL_ERROR',
      `OpenRouter key endpoint returned ${res.status}`,
      'Não foi possível obter dados de custo.',
      502,
    );
  }

  const data = await res.json() as {
    label: string;
    limit: number | null;
    limit_remaining: number | null;
    usage: number;
    usage_daily: number;
    usage_weekly: number;
    usage_monthly: number;
    is_free_tier: boolean;
  };

  return apiSuccess({
    label: data.label,
    limit: data.limit,
    limitRemaining: data.limit_remaining,
    usage: {
      allTime: data.usage,
      daily: data.usage_daily,
      weekly: data.usage_weekly,
      monthly: data.usage_monthly,
    },
    isFreeTier: data.is_free_tier,
    ts: new Date().toISOString(),
  });
}
