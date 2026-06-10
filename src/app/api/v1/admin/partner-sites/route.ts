import 'server-only';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { AppError } from '@/server/lib/errors';
import { apiError, apiSuccess } from '@/server/lib/response';
import { prisma } from '@/server/db/client';

export const dynamic = 'force-dynamic';

function requireAdmin(role: string) {
  if (role !== 'admin') {
    throw new AppError('INSUFFICIENT_PERMISSIONS', 'Admin only', 'Acesso restrito a administradores.', 403);
  }
}

// GET /api/v1/admin/partner-sites — list ALL sites in the platform (admin only).
// Regular GET /api/v1/partner-sites returns only the user's subscribed sites.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    requireAdmin(ctx.role);

    const sites = await prisma.partnerSite.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { propertySources: true } } },
    });

    return apiSuccess({ data: sites });
  } catch (err) {
    return apiError(err);
  }
}
