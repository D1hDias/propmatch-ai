import 'server-only';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { AppError } from '@/server/lib/errors';
import { apiError, apiSuccess } from '@/server/lib/response';
import { prisma } from '@/server/db/client';

function requireAdmin(role: string) {
  if (role !== 'admin') {
    throw new AppError('INSUFFICIENT_PERMISSIONS', 'Admin only', 'Acesso restrito a administradores.', 403);
  }
}

// GET /api/v1/admin/users
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    requireAdmin(ctx.role);

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        plan: true,
        createdAt: true,
        lgpdConsentAt: true,
        _count: { select: { briefings: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return apiSuccess(users);
  } catch (err) {
    return apiError(err);
  }
}
