import 'server-only';
import crypto from 'crypto';
import { prisma } from '@/server/db/client';
import { AppError } from '@/server/lib/errors';

const GRACE_PERIOD_DAYS = 7;
const DELETION_DEADLINE_DAYS = 30;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initiates a deletion request for the authenticated user.
 * Creates an lgpd_jobs row with status=requested and a cancellation token
 * valid for GRACE_PERIOD_DAYS. The actual deletion runs via the nightly cron
 * job (OPS-1, Sprint 2) after the grace period expires.
 */
export async function requestDeletion(userId: string): Promise<{
  jobId: string;
  cancellationToken: string;
  gracePeriodEndsAt: Date;
}> {
  // Reject if a pending deletion already exists for this user
  const existing = await prisma.lgpdJob.findFirst({
    where: {
      userId,
      jobType: 'delete',
      status: { in: ['requested', 'cancellable', 'in_progress'] },
    },
  });

  if (existing) {
    throw new AppError(
      'RESOURCE_CONFLICT',
      `Active deletion job already exists: ${existing.id}`,
      'Você já tem uma solicitação de exclusão em andamento.',
      409,
    );
  }

  const cancellationToken = crypto.randomBytes(32).toString('hex');
  const gracePeriodEndsAt = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const job = await prisma.lgpdJob.create({
    data: {
      userId,
      jobType: 'delete',
      status: 'cancellable',
      cancellationToken,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: 'lgpd.delete_requested',
      targetType: 'user',
      targetId: userId,
      details: { jobId: job.id, gracePeriodEndsAt },
    },
  });

  return { jobId: job.id, cancellationToken, gracePeriodEndsAt };
}

/**
 * Cancels a pending deletion request within the 7-day grace period.
 * Uses the one-time cancellation token from the confirmation email.
 */
export async function cancelDeletion(
  userId: string,
  cancellationToken: string,
): Promise<void> {
  const job = await prisma.lgpdJob.findFirst({
    where: {
      userId,
      cancellationToken,
      status: 'cancellable',
      jobType: 'delete',
    },
  });

  if (!job) {
    throw new AppError(
      'RESOURCE_NOT_FOUND',
      'No cancellable deletion job found for token',
      'Token de cancelamento inválido ou prazo expirado.',
      404,
    );
  }

  await prisma.lgpdJob.update({
    where: { id: job.id },
    data: { status: 'completed', completedAt: new Date(), cancellationToken: null },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: 'lgpd.delete_cancelled',
      targetType: 'lgpd_job',
      targetId: job.id,
    },
  });
}

/**
 * Executes the full deletion for a user whose grace period has expired.
 * Called by the nightly cron job (OPS-1). Safe to call multiple times (idempotent).
 *
 * Deletion strategy (per docs/lgpd-compliance.md):
 * - Anonymize the user record (name, email, phone → hashed placeholders)
 * - Revoke all refresh tokens
 * - audit_log entries: actor_user_id is intentionally retained (24mo legal minimum)
 *   and will be tokenized at month 12 by the OPS-6 cron
 * - lgpd_jobs record marked completed (retained 24mo per compliance table)
 */
export async function executeDeletion(jobId: string): Promise<void> {
  const job = await prisma.lgpdJob.findUniqueOrThrow({ where: { id: jobId } });

  if (job.status === 'completed') return; // idempotent

  if (job.status !== 'in_progress') {
    throw new AppError(
      'VALIDATION_FAILED',
      `Job ${jobId} is in status ${job.status}, expected in_progress`,
      'Estado de job inválido para execução.',
      422,
    );
  }

  const userId = job.userId;
  const anonEmail = `deleted_${crypto.createHash('sha256').update(userId).digest('hex').slice(0, 16)}@deleted.local`;

  await prisma.$transaction(async (tx) => {
    // Anonymize user PII
    await tx.user.update({
      where: { id: userId },
      data: {
        email: anonEmail,
        name: '[Conta excluída]',
        phone: null,
        passwordHash: '[deleted]',
      },
    });

    // Revoke all active sessions
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Mark job complete
    await tx.lgpdJob.update({
      where: { id: jobId },
      data: { status: 'completed', completedAt: new Date() },
    });

    // Audit (actor_user_id intentionally kept for 24mo legal retention)
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'lgpd.delete_executed',
        targetType: 'user',
        targetId: userId,
        details: { jobId, anonymizedEmail: anonEmail },
      },
    });
  });
}

/**
 * Advances jobs past the grace period from 'cancellable' → 'in_progress'.
 * Called by the nightly cron (OPS-1, Sprint 2). Returns count of jobs advanced.
 */
export async function advancePastGracePeriod(): Promise<number> {
  const cutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const result = await prisma.lgpdJob.updateMany({
    where: {
      jobType: 'delete',
      status: 'cancellable',
      requestedAt: { lt: cutoff },
    },
    data: { status: 'in_progress', cancellationToken: null },
  });

  return result.count;
}

/**
 * Deadline enforcement: marks stale in_progress jobs as failed.
 * Any job that has been in_progress for more than DELETION_DEADLINE_DAYS is a bug —
 * alert and log so ops can intervene.
 */
export async function flagOverdueJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - DELETION_DEADLINE_DAYS * 24 * 60 * 60 * 1000);

  const overdue = await prisma.lgpdJob.findMany({
    where: { jobType: 'delete', status: 'in_progress', requestedAt: { lt: cutoff } },
  });

  for (const job of overdue) {
    await prisma.lgpdJob.update({ where: { id: job.id }, data: { status: 'failed' } });
    await prisma.auditLog.create({
      data: {
        action: 'lgpd.delete_overdue',
        targetType: 'lgpd_job',
        targetId: job.id,
        details: { jobId: job.id, userId: job.userId },
      },
    });
  }

  return overdue.length;
}
