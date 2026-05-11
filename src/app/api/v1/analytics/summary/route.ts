import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { prisma } from '@/server/db/client';
import { apiSuccess, apiError } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

// GET /api/v1/analytics/summary
// KPIs + weekly history (12w) + top neighborhoods + CRM distribution

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const userId = ctx.sub;

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);

    // ── KPIs ──────────────────────────────────────────────────────────────

    const [
      totalBriefings,
      briefingsThisWeek,
      totalResults,
      resultsThisMonth,
      totalMessages,
      messagesThisWeek,
      clientsActive,
    ] = await Promise.all([
      prisma.briefing.count({ where: { userId } }),
      prisma.briefing.count({ where: { userId, createdAt: { gte: weekStart } } }),
      prisma.briefingResult.count({
        where: { briefing: { userId } },
      }),
      prisma.briefingResult.count({
        where: { briefing: { userId }, createdAt: { gte: monthStart } },
      }),
      // Messages are scoped via briefing → userId
      prisma.message.count({ where: { briefing: { userId } } }),
      prisma.message.count({ where: { briefing: { userId }, createdAt: { gte: weekStart } } }),
      prisma.client.count({ where: { userId, isGuest: false, archiveStatus: 'active' } }),
    ]);

    // ── CRM status distribution ────────────────────────────────────────────

    const crmGroups = await prisma.client.groupBy({
      by: ['crmStatus'],
      where: { userId, isGuest: false, archiveStatus: 'active' },
      _count: { _all: true },
    });

    const crmDistribution = Object.fromEntries(
      crmGroups.map((g) => [g.crmStatus, g._count._all]),
    );

    // ── Weekly briefing history (last 12 weeks) ───────────────────────────

    const recentBriefings = await prisma.briefing.findMany({
      where: { userId, createdAt: { gte: twelveWeeksAgo } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Bucket by week (ISO week index from twelveWeeksAgo)
    const weeklyBuckets: number[] = Array(12).fill(0);
    for (const b of recentBriefings) {
      const diffMs = b.createdAt.getTime() - twelveWeeksAgo.getTime();
      const weekIdx = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
      if (weekIdx >= 0 && weekIdx < 12) weeklyBuckets[weekIdx] = (weeklyBuckets[weekIdx] ?? 0) + 1;
    }

    const weeklyHistory = weeklyBuckets.map((count, i) => {
      const weekDate = new Date(twelveWeeksAgo.getTime() + i * 7 * 24 * 60 * 60 * 1000);
      return {
        week: weekDate.toISOString().slice(0, 10),
        briefings: count,
      };
    });

    // ── Top neighborhoods from client profiles ────────────────────────────

    const clientsWithProfile = await prisma.client.findMany({
      where: { userId, isGuest: false, archiveStatus: 'active' },
      select: { profile: true },
    });

    const neighborhoodCount: Record<string, number> = {};
    for (const c of clientsWithProfile) {
      const profile = c.profile as { neighborhoods?: string[] } | null;
      for (const n of profile?.neighborhoods ?? []) {
        neighborhoodCount[n] = (neighborhoodCount[n] ?? 0) + 1;
      }
    }

    const topNeighborhoods = Object.entries(neighborhoodCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    // ── Recent briefings (last 5) ─────────────────────────────────────────

    const recentActivity = await prisma.briefing.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        createdAt: true,
        rawText: false,
        client: { select: { id: true, name: true, isGuest: true } },
        _count: { select: { results: true } },
      },
    });

    return apiSuccess({
      kpis: {
        totalBriefings,
        briefingsThisWeek,
        totalResults,
        resultsThisMonth,
        totalMessages,
        messagesThisWeek,
        clientsActive,
      },
      crmDistribution,
      weeklyHistory,
      topNeighborhoods,
      recentActivity,
    });
  } catch (err) {
    return apiError(err);
  }
}
