# LGPD Manual Deletion Playbook

**Status:** Active — used until the automated cron (OPS-1, Sprint 2) is deployed to production.  
**Audience:** Ops on-call, Legal, Engineering lead.  
**Counsel sign-off:** Required before first use in production. Attach confirmation as a PR comment on the AUTH-4 PR.

---

## When to use this playbook

1. **Automated cron is not yet deployed** (MVP grace period, Sprint 1 / W1–W2).
2. **Automated cron failed** — the `lgpd.delete_overdue` audit log event fired and engineering cannot fix within 24h.
3. **Emergency request** — user submits a deletion request and requests immediate processing (7-day grace period waived by mutual agreement, documented in writing).

Do not run this playbook without confirming the requestor's identity first.

---

## Pre-conditions

- You have a terminal connected to the production VPS.
- You have credentials for the `propmatch_service` Postgres role (`/etc/propmatch/secrets.env`).
- The `lgpd_jobs` row for the user exists with `status = 'cancellable'` or `'in_progress'`.
- Legal has confirmed the request is valid and the grace period has passed (or been waived).

---

## Step 1 — Identify the user and job

```sql
-- Connect as service role
\c propmatch_dev
SET ROLE propmatch_service;

-- Find the deletion job
SELECT
  j.id        AS job_id,
  j.user_id,
  j.status,
  j.requested_at,
  u.email,
  u.name
FROM lgpd_jobs j
JOIN users u ON u.id = j.user_id
WHERE j.job_type = 'delete'
  AND j.status IN ('cancellable', 'in_progress')
ORDER BY j.requested_at DESC;
```

Record the `job_id` and `user_id`. Verify with the requestor that the `email` matches.

---

## Step 2 — Advance to in_progress (if still cancellable)

```sql
UPDATE lgpd_jobs
SET status = 'in_progress', cancellation_token = NULL
WHERE id = '<job_id>'
  AND status = 'cancellable';
-- Expected: UPDATE 1
```

---

## Step 3 — Anonymize PII

```sql
BEGIN;

-- Anonymize user record
UPDATE users
SET
  email         = 'deleted_' || encode(sha256(id::text::bytea), 'hex')::text || '@deleted.local',
  name          = '[Conta excluída]',
  phone         = NULL,
  password_hash = '[deleted]'
WHERE id = '<user_id>';
-- Expected: UPDATE 1

-- Revoke active sessions
UPDATE refresh_tokens
SET revoked_at = NOW()
WHERE user_id = '<user_id>'
  AND revoked_at IS NULL;
-- Expected: UPDATE N (any number >= 0)

-- Mark job complete
UPDATE lgpd_jobs
SET status = 'completed', completed_at = NOW()
WHERE id = '<job_id>';
-- Expected: UPDATE 1

-- Audit the manual deletion (actor_user_id kept for 24mo legal retention)
INSERT INTO audit_log (actor_user_id, action, target_type, target_id, details)
VALUES (
  '<user_id>',
  'lgpd.delete_executed_manual',
  'user',
  '<user_id>',
  jsonb_build_object(
    'job_id',       '<job_id>',
    'performed_by', '<your-name>',
    'reason',       'manual playbook execution'
  )
);

COMMIT;
```

---

## Step 4 — Verify

```sql
-- User row should show anonymized data
SELECT id, email, name, phone FROM users WHERE id = '<user_id>';
-- email: deleted_<hash>@deleted.local
-- name:  [Conta excluída]
-- phone: NULL

-- lgpd_jobs row should be completed
SELECT id, status, completed_at FROM lgpd_jobs WHERE id = '<job_id>';
-- status: completed

-- audit_log should have the deletion event
SELECT action, created_at FROM audit_log
WHERE target_id = '<user_id>'::uuid
ORDER BY created_at DESC
LIMIT 5;
```

---

## Step 5 — Downstream data (deferred)

The following will be cleaned up by future cron jobs as they land in production:

| Data | Cron ticket | Schedule |
|------|-------------|----------|
| `briefings.raw_text` | OPS-1 (S2) | Daily |
| `clients` linked to this broker | OPS-3/OPS-4 (S5) | Daily |
| `messages` phone hash | OPS-7 (S6) | Daily |

If an urgent full deletion is required before these crons exist, run the SQL from `docs/lgpd-compliance.md` manually for the relevant `user_id`, inside a transaction, and document in `audit_log`.

---

## Rollback

If you need to undo a manual deletion (only possible before the transaction commits):

```sql
-- Only valid before COMMIT. Once committed, deletion is permanent by design.
-- Contact engineering lead before attempting.
ROLLBACK;
```

Once committed, the deletion is permanent (LGPD Art.16 — exceptions only for legal obligations). Do not attempt to restore a committed deletion without explicit legal instruction.

---

## Checklist pós-execução

- [ ] Job marcado como `completed` no banco
- [ ] Email do usuário anonimizado (`deleted_*@deleted.local`)
- [ ] Sessões ativas revogadas (`refresh_tokens.revoked_at` preenchido)
- [ ] Evento `lgpd.delete_executed_manual` visível no `audit_log`
- [ ] Notificação enviada ao usuário (e-mail manual via Resend até S7)
- [ ] Registro no canal `#lgpd-ops` no Slack com job_id e responsável

---

## Contacts

| Role | Who |
|------|-----|
| Engineering lead | Diego Dias |
| Legal counsel | *[a preencher na assinatura do contrato]* |
| DPO | *[a nomear antes do launch público]* |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Engineering | Initial draft |
| — | Counsel | Pending sign-off |
