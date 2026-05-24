import 'server-only';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/auth/context';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError } from '@/server/lib/response';
import { updatePartnerSite, disablePartnerSite } from '@/server/partners';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  discoveryStrategy: z.enum(['map_then_scrape', 'crawl', 'direct_scrape', 'interact']).optional(),
  propertyUrlPatterns: z.array(z.string()).optional(),
  listingUrlPatterns: z.array(z.string()).optional(),
  // Broker-provided static search-result URLs used as scraping entry points.
  seedUrls: z.array(z.string().url('URL inválida nas seedUrls')).max(20).optional(),
  includePaths: z.array(z.string()).optional(),
  excludePaths: z.array(z.string()).optional(),
  crawlDepthDefault: z.number().int().min(1).max(10).optional(),
  crawlLimitDefault: z.number().int().min(1).max(200).optional(),
  ignoreQueryParams: z.boolean().optional(),
  needsInteract: z.boolean().optional(),
  needsJavascript: z.boolean().optional(),
  usesSitemap: z.boolean().optional(),
  // When true, discovery() will not overwrite URL patterns.
  profileLocked: z.boolean().optional(),
  active: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

// PATCH /api/v1/partner-sites/:id — update partner site configuration
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', parsed.error.message, 'Dados inválidos.', 400);
    }
    const site = await updatePartnerSite(id, parsed.data);
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
