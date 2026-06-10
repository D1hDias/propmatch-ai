import 'server-only';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/auth/context';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError } from '@/server/lib/response';
import { updatePartnerSite, disablePartnerSite, setPartnerSiteDismissed } from '@/server/partners';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  // Corrects the site URL — also updates domain. Checked for uniqueness.
  baseUrl: z.string().url('URL inválida').optional(),
  discoveryStrategy: z.enum(['map_then_scrape', 'crawl', 'direct_scrape', 'interact']).optional(),
  propertyUrlPatterns: z.array(z.string()).optional(),
  listingUrlPatterns: z.array(z.string()).optional(),
  seedUrls: z.array(z.string().url('URL inválida nas seedUrls')).max(20).optional(),
  includePaths: z.array(z.string()).optional(),
  excludePaths: z.array(z.string()).optional(),
  crawlDepthDefault: z.number().int().min(1).max(10).optional(),
  crawlLimitDefault: z.number().int().min(1).max(200).optional(),
  ignoreQueryParams: z.boolean().optional(),
  needsInteract: z.boolean().optional(),
  needsJavascript: z.boolean().optional(),
  usesSitemap: z.boolean().optional(),
  profileLocked: z.boolean().optional(),
  active: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
  // Per-user preference: removes/restores site from the broker's personal list.
  dismissed: z.boolean().optional(),
});

// PATCH /api/v1/partner-sites/:id — update partner site configuration or broker preference
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', parsed.error.message, 'Dados inválidos.', 400);
    }
    const { dismissed, ...siteFields } = parsed.data;
    // Handle per-user dismissal separately — never stored on the PartnerSite record.
    if (dismissed !== undefined) {
      await setPartnerSiteDismissed(ctx.sub, id, dismissed);
    }
    // Update site fields if any were provided.
    const hasSiteFields = Object.keys(siteFields).length > 0;
    const site = hasSiteFields
      ? await updatePartnerSite(id, siteFields)
      : await import('@/server/partners').then((m) => m.getPartnerSite(id));
    return apiSuccess({ data: site });
  } catch (err) {
    return apiError(err);
  }
}

// DELETE /api/v1/partner-sites/:id — soft-disable partner site
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth(req);
    const { id } = await params;
    await disablePartnerSite(id);
    return apiSuccess({ disabled: true });
  } catch (err) {
    return apiError(err);
  }
}
