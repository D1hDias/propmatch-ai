import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/auth/context';
import { prisma } from '@/server/db/client';
import { apiSuccess, apiError } from '@/server/lib/response';

// GET  /api/v1/clients  — list active clients for the authenticated broker
// POST /api/v1/clients  — create a saved (non-guest) client

const createSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().regex(/^\+\d{7,15}$/).optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const includeArchived = searchParams.get('archived') === 'true';

    const clients = await prisma.client.findMany({
      where: {
        userId: ctx.sub,
        ...(!includeArchived ? { archiveStatus: 'active' } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        phone: true,
        isGuest: true,
        archiveStatus: true,
        notes: true,
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
    const body = createSchema.parse(await req.json());

    const client = await prisma.client.create({
      data: {
        userId: ctx.sub,
        name: body.name,
        phone: body.phone ?? null,
        notes: body.notes ?? null,
        isGuest: false,
      },
    });

    return apiSuccess({ client }, 201);
  } catch (err) {
    return apiError(err);
  }
}
