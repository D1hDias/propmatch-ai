import 'server-only';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/auth/context';
import { getStripe, PLAN_PRICE_IDS, type BillingPlan } from '@/server/billing/stripe';
import { prisma } from '@/server/db/client';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  plan: z.enum(['starter', 'pro']),
});

// POST /api/v1/billing/checkout
// Creates a Stripe Checkout session and returns the URL.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', parsed.error.message, 'Plano inválido.', 400);
    }
    const { plan } = parsed.data as { plan: BillingPlan };

    const priceId = PLAN_PRICE_IDS[plan];
    if (!priceId) {
      throw new AppError(
        'INTERNAL_ERROR',
        `Price ID not configured for plan=${plan}`,
        'Configuração de billing indisponível. Tente novamente mais tarde.',
        500,
      );
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.sub },
      select: { email: true, name: true },
    });

    const stripe = getStripe();
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId: ctx.sub, plan },
      success_url: `${baseUrl}/settings/billing?checkout=success&plan=${plan}`,
      cancel_url: `${baseUrl}/settings/billing?checkout=cancelled`,
      subscription_data: {
        metadata: { userId: ctx.sub, plan },
      },
    });

    return apiSuccess({ url: session.url }, 201);
  } catch (err) {
    return apiError(err);
  }
}
