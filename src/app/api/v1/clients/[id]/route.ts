import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/auth/context';
import { prisma } from '@/server/db/client';
import { apiSuccess, apiError } from '@/server/lib/response';
import { AppError } from '@/server/lib/errors';

// PATCH /api/v1/clients/{id} — update name/phone/notes/archiveStatus
// DELETE /api/v1/clients/{id} — soft-archive (sets archive_status = soft_archived)

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().regex(/^\+\d{7,15}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  archiveStatus: z.enum(['active', 'soft_archived', 'pending_delete']).optional(),
});

async function findOwned(id: string, userId: string) {
  const client = await prisma.client.findFirst({ where: { id, userId } });
  if (!client) {
    throw new AppError('RESOURCE_NOT_FOUND', `Client ${id} not found`, 'Cliente não encontrado.', 404);
  }
  return client;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;
    await findOwned(id, ctx.sub);

    const body = patchSchema.parse(await req.json());

    const now = new Date();
    const updated = await prisma.client.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.archiveStatus === 'soft_archived'
          ? { archiveStatus: 'soft_archived', softArchivedAt: now, autoPurgeAt: new Date(now.getTime() + 540 * 24 * 60 * 60 * 1000) }
          : body.archiveStatus === 'active'
          ? { archiveStatus: 'active', softArchivedAt: null, autoPurgeAt: null }
          : body.archiveStatus === 'pending_delete'
          ? { archiveStatus: 'pending_delete' }
          : {}),
      },
    });

    return apiSuccess({ client: updated });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;
    const client = await findOwned(id, ctx.sub);

    if (client.archiveStatus !== 'active') {
      throw new AppError('RESOURCE_CONFLICT', 'Client is already archived', 'Cliente já está arquivado.', 409);
    }

    const now = new Date();
    await prisma.client.update({
      where: { id },
      data: {
        archiveStatus: 'soft_archived',
        softArchivedAt: now,
        autoPurgeAt: new Date(now.getTime() + 540 * 24 * 60 * 60 * 1000),
      },
    });

    return apiSuccess({ id, archived: true });
  } catch (err) {
    return apiError(err);
  }
}
