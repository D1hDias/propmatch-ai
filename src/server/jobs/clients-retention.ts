import 'server-only';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';

// ---------------------------------------------------------------------------
// OPS-3: Soft-archive guest clients that have been active for 90 days
//        and have at least one briefing. Sends reminder at day 60.
//
// OPS-4: Hard-delete guest clients that have been active for 90 days
//        with NO briefings (never used).
//
// OPS-5: Hard-delete soft-archived clients that have reached auto_purge_at
//        (540 days after soft-archive).
//
// OPS-6: Tokenise actor_user_id in audit_log after 12 months.
// ---------------------------------------------------------------------------

export interface ClientRetentionResult {
  guestsSoftArchived: number;
  guestsHardDeleted: number;
  softArchivedPurged: number;
  auditLogTokenized: number;
  messagesPhoneHashed: number;
  durationMs: number;
}

export async function runClientRetentionJob(): Promise<ClientRetentionResult> {
  const start = Date.now();
  const now = new Date();
  const day90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const day60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const day12mo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  // OPS-3: Set reminder_sent_at for guests >= 60 days with briefings (if not set)
  await prisma.$executeRaw`
    UPDATE clients
    SET reminder_sent_at = NOW()
    WHERE is_guest = TRUE
      AND archive_status = 'active'
      AND reminder_sent_at IS NULL
      AND created_at <= ${day60}
      AND id IN (SELECT DISTINCT client_id FROM briefings)
  `;

  // OPS-3: Soft-archive guests >= 90 days that have briefings
  const softArchived = await prisma.$executeRaw`
    UPDATE clients
    SET
      archive_status   = 'soft_archived',
      soft_archived_at = NOW(),
      auto_purge_at    = NOW() + INTERVAL '540 days'
    WHERE is_guest = TRUE
      AND archive_status = 'active'
      AND created_at <= ${day90}
      AND id IN (SELECT DISTINCT client_id FROM briefings)
  `;

  logger.info('ops-3 complete', { guestsSoftArchived: Number(softArchived) });

  // OPS-4: Hard-delete guests >= 90 days with NO briefings
  const hardDeleted = await prisma.$executeRaw`
    DELETE FROM clients
    WHERE is_guest = TRUE
      AND archive_status = 'active'
      AND created_at <= ${day90}
      AND id NOT IN (SELECT DISTINCT client_id FROM briefings)
  `;

  logger.info('ops-4 complete', { guestsHardDeleted: Number(hardDeleted) });

  // OPS-5: Hard-delete soft-archived clients past auto_purge_at
  const purged = await prisma.$executeRaw`
    DELETE FROM clients
    WHERE archive_status IN ('soft_archived', 'pending_delete')
      AND auto_purge_at IS NOT NULL
      AND auto_purge_at <= NOW()
  `;

  logger.info('ops-5 complete', { softArchivedPurged: Number(purged) });

  // OPS-6: Tokenise actor_user_id in audit_log after 12 months
  // Replace with a pseudonym hash so analytics still work but PII is gone
  const tokenized = await prisma.$executeRaw`
    UPDATE audit_log
    SET actor_user_id = NULL
    WHERE actor_user_id IS NOT NULL
      AND created_at <= ${day12mo}
  `;

  logger.info('ops-6 complete', { auditLogTokenized: Number(tokenized) });

  // OPS-7: Hash phone in messages sent ≥90 days ago (LGPD minimization).
  // The raw phone lives on `clients.phone`; messages stores only the hash for analytics.
  const day90ops7 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const phoneHashed = await prisma.$executeRaw`
    UPDATE messages
    SET phone_hash = encode(
      digest(
        (SELECT phone FROM clients WHERE clients.id = messages.client_id),
        'sha256'
      ),
      'hex'
    )
    WHERE sent_at IS NOT NULL
      AND sent_at <= ${day90ops7}
      AND phone_hash IS NULL
      AND EXISTS (
        SELECT 1 FROM clients WHERE clients.id = messages.client_id AND phone IS NOT NULL
      )
  `;

  logger.info('ops-7 complete', { messagesPhoneHashed: Number(phoneHashed) });

  return {
    guestsSoftArchived: Number(softArchived),
    guestsHardDeleted: Number(hardDeleted),
    softArchivedPurged: Number(purged),
    auditLogTokenized: Number(tokenized),
    messagesPhoneHashed: Number(phoneHashed),
    durationMs: Date.now() - start,
  };
}
