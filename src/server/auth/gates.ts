import 'server-only';
import { AppError } from '@/server/lib/errors';
import type { RequestContext } from './context';

export type Plan = 'free' | 'starter' | 'pro';

const PLAN_RANK: Record<Plan, number> = { free: 0, starter: 1, pro: 2 };

/**
 * Asserts that the current user's plan meets the minimum required plan.
 * Throws AppError('FEATURE_GATED') if not.
 *
 * Usage:
 *   requirePlan(ctx, 'starter'); // free users get 403
 */
export function requirePlan(ctx: RequestContext, minPlan: Plan): void {
  const userPlan = ctx.plan as Plan;
  const userRank = PLAN_RANK[userPlan] ?? 0;
  const minRank = PLAN_RANK[minPlan];

  if (userRank < minRank) {
    throw new AppError(
      'FEATURE_GATED',
      `Feature requires plan=${minPlan}, user has plan=${userPlan}`,
      `Esta funcionalidade está disponível a partir do plano ${minPlan === 'starter' ? 'Starter' : 'Pro'}.`,
      403,
    );
  }
}
