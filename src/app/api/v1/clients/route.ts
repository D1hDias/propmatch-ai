import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { prisma } from '@/server/db/client';
import { apiSuccess, apiError } from '@/server/lib/response';
import { createClientSchema } from '@/lib/schemas/client';

export const dynamic = 'force-dynamic';

// GET  /api/v1/clients  — list clients for the authenticated broker
// POST /api/v1/clients  — create a saved (non-guest) client

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const includeArchived = searchParams.get('archived') === 'true';
    const crmStatus = searchParams.get('crm_status');

    const clients = await prisma.client.findMany({
      where: {
        userId: ctx.sub,
        isGuest: false,
        ...(!includeArchived ? { archiveStatus: 'active' } : {}),
        ...(crmStatus ? { crmStatus: crmStatus as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        isGuest: true,
        archiveStatus: true,
        crmStatus: true,
        urgency: true,
        matchThreshold: true,
        notes: true,
        profile: true,
        createdAt: true,
        _count: { select: { briefings: true } },
      },
    });

    return apiSuccess({ clients });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const body = createClientSchema.parse(await req.json());

    const client = await prisma.client.create({
      data: {
        userId: ctx.sub,
        name: body.name,
        phone: body.phone || null,
        email: body.email || null,
        notes: body.notes ?? null,
        urgency: body.urgency,
        crmStatus: body.crmStatus,
        matchThreshold: body.matchThreshold,
        profile: body.profile ?? undefined,
        isGuest: false,
      },
    });

    return apiSuccess({ client }, 201);
  } catch (err) {
    return apiError(err);
  }
}
