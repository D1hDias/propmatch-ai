import 'server-only';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { apiSuccess, apiError } from '@/server/lib/response';
import { getPartnerSite } from '@/server/partners';
import { enqueueSiteSync } from '@/server/partners/sync-queue';

export const dynamic = 'force-dynamic';

// POST /api/v1/partner-sites/:id/sync
// Enqueues a background inventory sync for the given partner site.
// Returns immediately — the sync runs asynchronously via the BullMQ worker.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth(req);
    const { id } = await params;

    // Verify site exists on the platform
    await getPartnerSite(id);

    await enqueueSiteSync(id);
    return apiSuccess({ data: { queued: true, partnerSiteId: id } });
  } catch (err) {
    return apiError(err);
  }
}
