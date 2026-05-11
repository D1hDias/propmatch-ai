import 'server-only';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { getStripe } from '@/server/billing/stripe';
import { prisma } from '@/server/db/client';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

// POST /api/v1/billing/portal
// Returns a Stripe Customer Portal session URL for the current user.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.sub },
      select: { email: true },
    });

    const stripe = getStripe();

    // Find or create Stripe customer by email
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customer = customers.data[0];

    if (!customer) {
      throw new AppError(
        'RESOURCE_NOT_FOUND',
        `No Stripe customer found for userId=${ctx.sub}`,
        'Nenhuma assinatura encontrada. Faça upgrade primeiro.',
        404,
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${baseUrl}/settings/billing`,
    });

    return apiSuccess({ url: session.url });
  } catch (err) {
    return apiError(err);
  }
}
