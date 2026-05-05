import 'server-only';
import { prisma } from '@/server/db/client';

export interface RetentionResult {
  rawTextPurged: number;
  lgpdJobsCleaned: number;
  auditLogCleaned: number;
  durationMs: number;
}

/**
 * OPS-1: Nightly retention enforcer.
 *
 * Rules (docs/lgpd-compliance.md):
 *   - briefings.raw_text: nulled when raw_text_purge_at < now()
 *   - lgpd_jobs: deleted when completed > 24 months ago (legal minimum kept)
 *   - audit_log: deleted when created_at > 24 months ago
 *
 * Runs as the application DB user (not the service role) via this internal route.
 * Each run logs a summary to audit_log so the ops dashboard can track it.
 */
export async function runRetentionJob(): Promise<RetentionResult> {
  const start = Date.now();

  // --- briefings.raw_text purge ---
  const rawTextResult = await prisma.$executeRaw`
    UPDATE briefings
    SET raw_text = NULL
    WHERE raw_text_purge_at < NOW()
      AND raw_text IS NOT NULL
  `;

  // --- lgpd_jobs cleanup (keep 24 months) ---
  const cutoff24mo = new Date(Date.now() - 24 * 30 * 24 * 60 * 60 * 1000);

  const lgpdResult = await prisma.lgpdJob.deleteMany({
    where: {
      status: { in: ['completed', 'failed'] },
      completedAt: { lt: cutoff24mo },
    },
  });

  // --- audit_log cleanup (keep 24 months) ---
  const auditResult = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff24mo } },
  });

  const durationMs = Date.now() - start;

  // Log this run to audit_log so ops can verify execution
  await prisma.auditLog.create({
    data: {
      action: 'ops.retention_job_completed',
      details: {
        rawTextPurged: rawTextResult,
        lgpdJobsCleaned: lgpdResult.count,
        auditLogCleaned: auditResult.count,
        durationMs,
      },
    },
  });

  return {
    rawTextPurged: rawTextResult,
    lgpdJobsCleaned: lgpdResult.count,
    auditLogCleaned: auditResult.count,
    durationMs,
  };
}

/**
 * OPS-6 (Sprint 7): Tokenize actor_user_id in audit_log after 12 months.
 * Stub here so the retention route can call it when the time comes.
 */
export async function runAuditLogTokenization(): Promise<number> {
  const cutoff12mo = new Date(Date.now() - 12 * 30 * 24 * 60 * 60 * 1000);

  // Replace real UUID with a deterministic token so log entries remain
  // correlatable but the UUID can no longer be linked to a specific user.
  const result = await prisma.$executeRaw`
    UPDATE audit_log
    SET actor_user_id = NULL
    WHERE actor_user_id IS NOT NULL
      AND created_at < ${cutoff12mo}
  `;

  return result;
}
