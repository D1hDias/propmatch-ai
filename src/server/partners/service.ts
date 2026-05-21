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

// Creates a partner site as a platform-wide asset.
// If the domain already exists (added by any user), returns it with created=false —
// the caller should skip discovery and simply show the existing site.
export async function createPartnerSite(
  userId: string,
  input: CreatePartnerSiteInput,
): Promise<{ site: Awaited<ReturnType<typeof prisma.partnerSite.create>>; created: boolean }> {
  const { domain, baseUrl } = extractDomain(input.url);

  const existing = await prisma.partnerSite.findUnique({ where: { domain } });
  if (existing) {
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

  const site = await prisma.partnerSite.create({
    data: { userId, domain, baseUrl, name: input.name },
  });
  return { site, created: true };
}

// Returns all active partner sites on the platform — shared across all brokers.
export async function listPartnerSites() {
  return prisma.partnerSite.findMany({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  });
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
  return prisma.partnerSite.update({ where: { id }, data });
}

export async function disablePartnerSite(id: string) {
  await getPartnerSite(id);
  await prisma.partnerSite.update({ where: { id }, data: { active: false } });
}
