import 'server-only';
import { prisma } from '@/server/db/client';
import { AppError } from '@/server/lib/errors';
import { validateRealEstateSite } from './validate';

export interface CreatePartnerSiteInput {
  url: string;
  name: string;
}

export interface UpdatePartnerSiteInput {
  name?: string;
  /** Updates both baseUrl and domain. Checked against @@unique([domain]). */
  baseUrl?: string;
  discoveryStrategy?: string;
  propertyUrlPatterns?: string[];
  listingUrlPatterns?: string[];
  seedUrls?: string[];
  includePaths?: string[];
  excludePaths?: string[];
  crawlDepthDefault?: number;
  crawlLimitDefault?: number;
  ignoreQueryParams?: boolean;
  needsInteract?: boolean;
  needsJavascript?: boolean;
  usesSitemap?: boolean;
  profileLocked?: boolean;
  active?: boolean;
  notes?: string | null;
}

function extractDomain(rawUrl: string): { domain: string; baseUrl: string } {
  try {
    const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    const domain = parsed.hostname;
    const baseUrl = `${parsed.protocol}//${parsed.hostname}`;
    return { domain, baseUrl };
  } catch {
    throw new AppError('VALIDATION_FAILED', `Invalid URL: ${rawUrl}`, 'URL inválida.', 400);
  }
}

// Creates a partner site as a platform-wide asset and subscribes the user to it.
// If the domain already exists (admin pre-registered or added by another user),
// returns the existing site and subscribes this user so it appears in their list.
export async function createPartnerSite(
  userId: string,
  input: CreatePartnerSiteInput,
): Promise<{ site: Awaited<ReturnType<typeof prisma.partnerSite.create>>; created: boolean }> {
  const { domain, baseUrl } = extractDomain(input.url);

  const [existing, userRecord] = await Promise.all([
    prisma.partnerSite.findUnique({ where: { domain } }),
    prisma.user.findUnique({ where: { id: userId }, select: { subscribedPartnerSiteIds: true } }),
  ]);
  const currentSubscribed = userRecord?.subscribedPartnerSiteIds ?? [];

  if (existing) {
    // Subscribe the user to the pre-existing site so it shows in their panel.
    if (!currentSubscribed.includes(existing.id)) {
      await prisma.user.update({
        where: { id: userId },
        data: { subscribedPartnerSiteIds: [...currentSubscribed, existing.id] },
      });
    }
    return { site: existing, created: false };
  }

  const validation = await validateRealEstateSite(input.url);
  if (!validation.valid) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Site ${domain} rejected: not a real estate site`,
      validation.reason,
      422,
    );
  }

  const [site] = await prisma.$transaction(async (tx) => {
    const newSite = await tx.partnerSite.create({
      data: { userId, domain, baseUrl, name: input.name },
    });
    await tx.user.update({
      where: { id: userId },
      data: { subscribedPartnerSiteIds: [...currentSubscribed, newSite.id] },
    });
    return [newSite];
  });
  return { site, created: true };
}

// A sync stuck in 'running' for longer than this is considered orphaned (server restart / crash).
const STALE_SYNC_MS = 2 * 60 * 60 * 1000; // 2 hours

// Returns partner sites the user has subscribed to (opt-in model).
// Backward compat: also includes sites the user originally created (userId match)
// before the subscribed_partner_site_ids field was introduced.
// Stale 'running' syncs (no DB update in >2h) are auto-reset to 'error' before returning.
export async function listPartnerSites(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscribedPartnerSiteIds: true, dismissedPartnerSiteIds: true },
  });

  const subscribedIds = user?.subscribedPartnerSiteIds ?? [];
  const dismissedIds = new Set(user?.dismissedPartnerSiteIds ?? []);

  const sites = await prisma.partnerSite.findMany({
    where: {
      active: true,
      // Show sites the user subscribed to OR created directly (backward compat).
      OR: [
        { id: { in: subscribedIds } },
        { userId },
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { propertySources: true } } },
  });

  const now = Date.now();
  const staleIds = sites
    .filter((s) => s.syncStatus === 'running' && (now - s.updatedAt.getTime()) > STALE_SYNC_MS)
    .map((s) => s.id);

  if (staleIds.length > 0) {
    await prisma.partnerSite.updateMany({
      where: { id: { in: staleIds } },
      data: { syncStatus: 'error', lastErrorAt: new Date() },
    });
    for (const s of sites) {
      if (staleIds.includes(s.id)) {
        s.syncStatus = 'error';
        s.lastErrorAt = new Date();
      }
    }
  }

  return sites.map((s) => ({ ...s, dismissed: dismissedIds.has(s.id) }));
}

// Removes (dismiss) or re-adds (restore) a partner site from the broker's personal list.
// Dismissing removes from subscribedPartnerSiteIds; restoring re-subscribes the user.
export async function setPartnerSiteDismissed(userId: string, siteId: string, dismissed: boolean) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dismissedPartnerSiteIds: true, subscribedPartnerSiteIds: true },
  });
  const currentDismissed = user?.dismissedPartnerSiteIds ?? [];
  const currentSubscribed = user?.subscribedPartnerSiteIds ?? [];

  if (dismissed) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        dismissedPartnerSiteIds: [...new Set([...currentDismissed, siteId])],
        subscribedPartnerSiteIds: currentSubscribed.filter((id) => id !== siteId),
      },
    });
  } else {
    await prisma.user.update({
      where: { id: userId },
      data: {
        dismissedPartnerSiteIds: currentDismissed.filter((id) => id !== siteId),
        subscribedPartnerSiteIds: [...new Set([...currentSubscribed, siteId])],
      },
    });
  }
}

// Looks up a partner site by id. Sites are global — no userId ownership check.
export async function getPartnerSite(id: string) {
  const site = await prisma.partnerSite.findFirst({ where: { id } });
  if (!site) {
    throw new AppError(
      'RESOURCE_NOT_FOUND',
      `PartnerSite ${id} not found`,
      'Site parceiro não encontrado.',
      404,
    );
  }
  return site;
}

// Updates a partner site's configuration. Sites are a platform asset — any authenticated
// user can contribute improvements to the profile (URL patterns, seed URLs, etc.).
export async function updatePartnerSite(id: string, data: UpdatePartnerSiteInput) {
  await getPartnerSite(id);
  const { baseUrl: rawBaseUrl, ...rest } = data;
  let domainFields: { domain?: string; baseUrl?: string } = {};
  if (rawBaseUrl) {
    const { domain, baseUrl } = extractDomain(rawBaseUrl);
    const conflict = await prisma.partnerSite.findUnique({ where: { domain } });
    if (conflict && conflict.id !== id) {
      throw new AppError('VALIDATION_FAILED', `Domain ${domain} already registered`, 'Domínio já cadastrado em outro parceiro.', 422);
    }
    domainFields = { domain, baseUrl };
  }
  return prisma.partnerSite.update({ where: { id }, data: { ...rest, ...domainFields } });
}

export async function disablePartnerSite(id: string) {
  await getPartnerSite(id);
  await prisma.partnerSite.update({ where: { id }, data: { active: false } });
}
