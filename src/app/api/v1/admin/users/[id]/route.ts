import 'server-only';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { AppError } from '@/server/lib/errors';
import { apiError, apiSuccess } from '@/server/lib/response';
import { prisma } from '@/server/db/client';
import { z } from 'zod';

function requireAdmin(role: string) {
  if (role !== 'admin') {
    throw new AppError('INSUFFICIENT_PERMISSIONS', 'Admin only', 'Acesso restrito a administradores.', 403);
  }
}

const PatchSchema = z.object({
  role: z.enum(['broker', 'owner', 'admin']).optional(),
  plan: z.enum(['free', 'starter', 'pro']).optional(),
});

// PATCH /api/v1/admin/users/:id
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    requireAdmin(ctx.role);
    const { id } = await params;

    const body = PatchSchema.parse(await req.json());

    // Prevent self-demotion
    if (id === ctx.sub && body.role && body.role !== 'admin') {
      throw new AppError('VALIDATION_FAILED', 'Cannot demote self', 'Não é possível remover seu próprio acesso admin.', 422);
    }

    const user = await prisma.user.update({
      where: { id },
      data: body,
      select: { id: true, email: true, role: true, plan: true },
    });

    return apiSuccess(user);
  } catch (err) {
    return apiError(err);
  }
}
