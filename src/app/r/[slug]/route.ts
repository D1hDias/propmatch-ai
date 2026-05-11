import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';

// GET /r/:slug — public redirect, no auth required
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const link = await prisma.shortLink.findUnique({
    where: { slug },
    select: { id: true, targetUrl: true },
  });

  if (!link) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Increment click counter without blocking the redirect
  void prisma.shortLink.update({
    where: { id: link.id },
    data: { clicks: { increment: 1 } },
  });

  return NextResponse.redirect(link.targetUrl, { status: 301 });
}
