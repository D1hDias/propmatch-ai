import 'server-only';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/auth/context';
import { withRlsContext } from '@/server/db/client';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: z.string().max(30).optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const user = await withRlsContext(ctx.sub, ctx.role, async (tx) => {
      return tx.user.findUnique({
        where: { id: ctx.sub },
        select: { id: true, name: true, email: true, phone: true, plan: true, role: true },
      });
    });
    if (!user) throw new AppError('RESOURCE_NOT_FOUND', 'User not found', 'Usuário não encontrado.', 404);
    return apiSuccess(user);
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const body: unknown = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Validation failed', 'Dados inválidos.', 400);
    }
    const updated = await withRlsContext(ctx.sub, ctx.role, async (tx) => {
      return tx.user.update({
        where: { id: ctx.sub },
        data: {
          ...(parsed.data.name !== undefined && { name: parsed.data.name }),
          ...(parsed.data.phone !== undefined && { phone: parsed.data.phone }),
        },
        select: { id: true, name: true, email: true, phone: true, plan: true, role: true },
      });
    });
    return apiSuccess(updated);
  } catch (err) {
    return apiError(err);
  }
}
