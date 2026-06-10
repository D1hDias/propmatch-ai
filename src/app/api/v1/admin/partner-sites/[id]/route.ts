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

// DELETE /api/v1/admin/partner-sites/:id
// Permanently removes a partner site and all its indexed data from the platform.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    requireAdmin(ctx.role);
    const { id } = await params;

    const site = await prisma.partnerSite.findUnique({ where: { id } });
    if (!site) {
      throw new AppError('RESOURCE_NOT_FOUND', `PartnerSite ${id} not found`, 'Site não encontrado.', 404);
    }

    await prisma.$transaction(async (tx) => {
      // Delete all property sources for this site
      await tx.propertySource_.deleteMany({ where: { partnerSiteId: id } });

      // Deactivate properties that now have no remaining sources
      const orphaned = await tx.property.findMany({
        where: { sources: { none: {} } },
        select: { id: true },
      });
      if (orphaned.length > 0) {
        await tx.property.deleteMany({
          where: { id: { in: orphaned.map((p) => p.id) } },
        });
      }

      // Stale IDs in dismissedPartnerSiteIds are harmless — the deleted site
      // won't appear in listPartnerSites() since it's gone from the DB.
      await tx.partnerSite.delete({ where: { id } });
    });

    return apiSuccess({ deleted: true });
  } catch (err) {
    return apiError(err);
  }
}
