import 'server-only';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { apiSuccess, apiError } from '@/server/lib/response';
import { getPartnerSite, discoverPartnerSite } from '@/server/partners';

export const dynamic = 'force-dynamic';

// POST /api/v1/partner-sites/:id/discover
// Runs Firecrawl MAP on the partner site and updates its URL patterns.
// Returns immediately with the updated site profile.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;

    const site = await getPartnerSite(id);

    // Run discovery synchronously — MAP takes 5-15s, within HTTP timeout
    await discoverPartnerSite(site);

    // Reload updated site from DB
    const updated = await getPartnerSite(id);
    return apiSuccess({ data: updated });
  } catch (err) {
    return apiError(err);
  }
}
