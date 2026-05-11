import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { createBriefingSchema } from '@/lib/schemas/briefing';
import { createBriefing, listBriefings } from '@/server/briefings/service';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

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

    const briefingId = await createBriefing(ctx.sub, parsed.data);
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

    const result = await listBriefings(ctx.sub, page, perPage);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
