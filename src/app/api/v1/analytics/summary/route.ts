import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { withRlsContext } from '@/server/db/client';
import { apiSuccess, apiError } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

// GET /api/v1/analytics/summary
// KPIs + weekly history (12w) + top neighborhoods + CRM distribution

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const userId = ctx.sub;

    const result = await withRlsContext(userId, ctx.role, async (tx) => {
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
        tx.briefing.count({ where: { userId } }),
        tx.briefing.count({ where: { userId, createdAt: { gte: weekStart } } }),
        tx.briefingResult.count({
          where: { briefing: { userId } },
        }),
        tx.briefingResult.count({
          where: { briefing: { userId }, createdAt: { gte: monthStart } },
        }),
        tx.message.count({ where: { briefing: { userId } } }),
        tx.message.count({ where: { briefing: { userId }, createdAt: { gte: weekStart } } }),
        tx.client.count({ where: { userId, isGuest: false, archiveStatus: 'active' } }),
      ]);

      // ── CRM status distribution ────────────────────────────────────────────

      const crmGroups = await tx.client.groupBy({
        by: ['crmStatus'],
        where: { userId, isGuest: false, archiveStatus: 'active' },
        _count: { _all: true },
      });

      const crmDistribution = Object.fromEntries(
        crmGroups.map((g) => [g.crmStatus, g._count._all]),
      );

      // ── Weekly briefing history (last 12 weeks) ───────────────────────────

      const recentBriefings = await tx.briefing.findMany({
        where: { userId, createdAt: { gte: twelveWeeksAgo } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 1000,
      });

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

      // ── Top neighborhoods from briefing extracted criteria ────────────────
      // Reads location.neighborhoods[] from each briefing's LLM-extracted criteria.

      const briefingsWithCriteria = await tx.briefing.findMany({
        where: { userId },
        select: { extractedCriteria: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      const neighborhoodCount: Record<string, number> = {};
      for (const b of briefingsWithCriteria) {
        const criteria = b.extractedCriteria as { location?: { neighborhoods?: string[] } } | null;
        for (const n of criteria?.location?.neighborhoods ?? []) {
          if (n) neighborhoodCount[n] = (neighborhoodCount[n] ?? 0) + 1;
        }
      }

      const topNeighborhoods = Object.entries(neighborhoodCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }));

      // ── Recent briefings (last 5) ─────────────────────────────────────────

      const recentActivity = await tx.briefing.findMany({
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

      return {
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
      };
    });

    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
