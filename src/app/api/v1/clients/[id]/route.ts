import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { prisma } from '@/server/db/client';
import { apiSuccess, apiError } from '@/server/lib/response';
import { AppError } from '@/server/lib/errors';
import { updateClientSchema } from '@/lib/schemas/client';

// GET    /api/v1/clients/{id} — client detail with scan history
// PATCH  /api/v1/clients/{id} — update profile / crm status / urgency
// DELETE /api/v1/clients/{id} — soft-archive

async function findOwned(id: string, userId: string) {
  const client = await prisma.client.findFirst({ where: { id, userId } });
  if (!client) {
    throw new AppError('RESOURCE_NOT_FOUND', `Client ${id} not found`, 'Cliente não encontrado.', 404);
  }
  return client;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;

    const client = await prisma.client.findFirst({
      where: { id, userId: ctx.sub },
      include: {
        briefings: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            createdAt: true,
            selectedPortals: true,
            customUrls: true,
            _count: { select: { results: true } },
          },
        },
      },
    });

    if (!client) {
      throw new AppError('RESOURCE_NOT_FOUND', `Client ${id} not found`, 'Cliente não encontrado.', 404);
    }

    // Scan history: for each briefing, count results with fitScore >= matchThreshold
    const scanHistory = await Promise.all(
      client.briefings.map(async (b) => {
        const aboveThreshold = await prisma.briefingResult.count({
          where: {
            briefingId: b.id,
            fitScore: { gte: client.matchThreshold },
          },
        });
        return {
          briefingId: b.id,
          status: b.status,
          createdAt: b.createdAt,
          totalResults: b._count.results,
          aboveThreshold,
          selectedPortals: b.selectedPortals,
          customUrlCount: b.customUrls.length,
        };
      }),
    );

    return apiSuccess({ client, scanHistory });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;
    await findOwned(id, ctx.sub);

    const body = updateClientSchema.parse(await req.json());

    const now = new Date();
    const updated = await prisma.client.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.urgency !== undefined ? { urgency: body.urgency } : {}),
        ...(body.crmStatus !== undefined ? { crmStatus: body.crmStatus } : {}),
        ...(body.matchThreshold !== undefined ? { matchThreshold: body.matchThreshold } : {}),
        ...(body.profile !== undefined ? { profile: body.profile ?? undefined } : {}),
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
