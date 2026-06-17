import 'server-only';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';

export async function logCoverageMetrics(siteId: string, domain: string): Promise<void> {
  const [total, withPhoto, withPrice, withNeighborhood] = await Promise.all([
    prisma.propertySource_.count({ where: { partnerSiteId: siteId } }),
    prisma.propertySource_.count({ where: { partnerSiteId: siteId, NOT: { photos: { equals: [] } } } }),
    prisma.property.count({ where: { active: true, sources: { some: { partnerSiteId: siteId } }, price: { gt: 0 } } }),
    prisma.property.count({ where: { active: true, sources: { some: { partnerSiteId: siteId } }, NOT: { neighborhood: null } } }),
  ]);
  const pctPhoto = total > 0 ? Math.round((withPhoto / total) * 100) : 0;
  const pctPrice = total > 0 ? Math.round((withPrice / total) * 100) : 0;
  const pctNeighborhood = total > 0 ? Math.round((withNeighborhood / total) * 100) : 0;
  const logLevel = (pctPhoto < 70 || pctPrice < 70 || pctNeighborhood < 70) ? 'warn' : 'info';
  logger[logLevel]('site_sync_coverage', {
    domain,
    total,
    pctPhoto,
    pctPrice,
    pctNeighborhood,
    alert: logLevel === 'warn',
  });
}
