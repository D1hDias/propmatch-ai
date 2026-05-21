import 'server-only';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/auth/context';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError } from '@/server/lib/response';
import { createPartnerSite, listPartnerSites } from '@/server/partners';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1).max(100),
});

// GET /api/v1/partner-sites — list active partner sites for the authenticated user
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const sites = await listPartnerSites();
    return apiSuccess({ data: sites });
  } catch (err) {
    return apiError(err);
  }
}

// POST /api/v1/partner-sites — create a new partner site
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', parsed.error.message, 'Dados inválidos.', 400);
    }
    const { site, created } = await createPartnerSite(ctx.sub, parsed.data);
    return apiSuccess({ data: site, created }, created ? 201 : 200);
  } catch (err) {
    return apiError(err);
  }
}
