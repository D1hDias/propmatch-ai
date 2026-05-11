import 'server-only';
import Stripe from 'stripe';

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  return new Stripe(key, { apiVersion: '2026-04-22.dahlia' });
}

// Price IDs from Stripe dashboard (set in env per environment)
export const PLAN_PRICE_IDS = {
  starter: process.env.STRIPE_PRICE_STARTER ?? '',
  pro: process.env.STRIPE_PRICE_PRO ?? '',
} as const;

export type BillingPlan = keyof typeof PLAN_PRICE_IDS;
