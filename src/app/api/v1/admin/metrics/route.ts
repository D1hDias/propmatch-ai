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

// GET /api/v1/admin/metrics
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    requireAdmin(ctx.role);

    const [
      totalSites,
      sitesByStatus,
      totalListings,
      totalUsers,
      usersByRole,
      usersByPlan,
      totalBriefings,
      recentErrors,
    ] = await Promise.all([
      prisma.partnerSite.count({ where: { active: true } }),
      prisma.partnerSite.groupBy({ by: ['syncStatus'], _count: true }),
      prisma.property.count({ where: { active: true } }),
      prisma.user.count(),
      prisma.user.groupBy({ by: ['role'], _count: true }),
      prisma.user.groupBy({ by: ['plan'], _count: true }),
      prisma.briefing.count(),
      prisma.partnerSite.findMany({
        where: { active: true, syncStatus: 'error' },
        select: { id: true, name: true, domain: true, consecutiveFailures: true, lastErrorAt: true },
        orderBy: { lastErrorAt: 'desc' },
        take: 10,
      }),
    ]);

    const topSites = await prisma.partnerSite.findMany({
      where: { active: true },
      select: { id: true, name: true, domain: true, listingCount: true, syncStatus: true, lastScrapedAt: true },
      orderBy: { listingCount: 'desc' },
      take: 15,
    });

    return apiSuccess({
      sites: {
        total: totalSites,
        byStatus: Object.fromEntries(sitesByStatus.map((s) => [s.syncStatus, s._count])),
        top: topSites,
        recentErrors,
      },
      listings: { total: totalListings },
      users: {
        total: totalUsers,
        byRole: Object.fromEntries(usersByRole.map((u) => [u.role, u._count])),
        byPlan: Object.fromEntries(usersByPlan.map((u) => [u.plan, u._count])),
      },
      briefings: { total: totalBriefings },
    });
  } catch (err) {
    return apiError(err);
  }
}
