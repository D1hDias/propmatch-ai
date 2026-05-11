import 'server-only';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/server/billing/stripe';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';

export const dynamic = 'force-dynamic';

// POST /api/v1/billing/webhook
// Stripe sends events here. Verify signature, update users.plan accordingly.
// IMPORTANT: Must not use requireAuth — Stripe calls this without a user JWT.
export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('billing.webhook: STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    logger.error('billing.webhook: signature verification failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Webhook signature invalid' }, { status: 400 });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    logger.error('billing.webhook: handler error', { eventType: event.type, error: (err as Error).message });
    // Return 200 to prevent Stripe from retrying — log and alert instead
    return NextResponse.json({ received: true, error: 'Handler failed — check logs' });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan as 'starter' | 'pro' | undefined;

      if (!userId || !plan) {
        logger.warn('billing.webhook: checkout.session.completed missing metadata', { sessionId: session.id });
        return;
      }

      await prisma.user.update({ where: { id: userId }, data: { plan } });
      await prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'billing.plan_upgraded',
          targetType: 'user',
          targetId: userId,
          details: { plan, stripeSessionId: session.id },
        },
      });
      logger.info('billing.webhook: plan upgraded', { userId, plan });
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.userId;
      if (!userId) return;

      // Map Stripe status to plan — cancelled/unpaid → free
      const status = sub.status;
      if (status === 'active' || status === 'trialing') {
        // Plan already set on checkout.session.completed; no change needed
        return;
      }
      // Any non-active status → downgrade to free
      await prisma.user.update({ where: { id: userId }, data: { plan: 'free' } });
      await prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'billing.plan_downgraded',
          targetType: 'user',
          targetId: userId,
          details: { stripeStatus: status, subscriptionId: sub.id },
        },
      });
      logger.info('billing.webhook: plan downgraded to free', { userId, stripeStatus: status });
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
      const sub = invoice.subscription ?? (invoice as unknown as { parent?: { subscription_details?: { subscription?: string } } }).parent?.subscription_details?.subscription;
      if (!sub) return;

      const subscriptionId = typeof sub === 'string' ? sub : (sub as Stripe.Subscription).id;
      const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
      const userId = subscription.metadata?.userId;
      if (!userId) return;

      await prisma.user.update({ where: { id: userId }, data: { plan: 'free' } });
      await prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'billing.payment_failed',
          targetType: 'user',
          targetId: userId,
          details: { invoiceId: invoice.id },
        },
      });
      logger.warn('billing.webhook: payment failed — downgraded to free', { userId });
      break;
    }

    default:
      // Ignore other events
      break;
  }
}
