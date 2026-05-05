# Runbook: LGPD Manual Deletion

This runbook covers the manual deletion process used during the 14-day post-launch grace period (per PRD §5.5) and as a fallback if the automated worker fails.

**Counsel sign-off:** Required before MVP launch. Sign-off attached to AUTH-4 PR.
**Owner:** Operations, on-call rotation.
**Estimated time:** 30–45 minutes per request.

## When to use this runbook

- During the 14-day grace period after MVP launch, every deletion request is processed manually in parallel with the automated worker as a verification check.
- After grace period: only when the automated worker fails or a request requires special handling (e.g., a broker disputing the scope of deletion).

## Prerequisites

- Read access to production PostgreSQL (via bastion host).
- Read access to S3 production bucket.
- Access to the `audit_log` table.
- 1Password credentials for `propmatch-prod-readonly`.
- A reviewer (peer engineer or counsel) to verify the steps before execution.

## SLA

- Acknowledge request within 2 business hours.
- Complete deletion within 30 days of the original request.
- Send completion confirmation to the user within 1 business day of completion.

## Procedure

### Step 1: Verify the request

The deletion request lands in the `lgpd_jobs` table with `job_type = 'delete'`. Confirm:

```sql
SELECT id, user_id, status, requested_at, completed_at, cancellation_token
FROM lgpd_jobs
WHERE job_type = 'delete'
  AND status IN ('cancellable', 'in_progress')
ORDER BY requested_at ASC;
```

Verify:
- The 7-day grace period has expired (`requested_at < NOW() - interval '7 days'`).
- The user has not cancelled (`status` is not `cancelled`).
- The user is the legitimate owner of the account (cross-reference with the email confirmation chain in support tickets if anything looks off).

If anything is unclear, escalate to counsel before proceeding.

### Step 2: Update job status

```sql
UPDATE lgpd_jobs
SET status = 'in_progress'
WHERE id = '<job_id>'
  AND status = 'cancellable';
```

Verify exactly 1 row was updated. If 0 rows, the job has already been picked up by another process — stop and investigate.

### Step 3: Snapshot user data (audit safety)

Before deletion, snapshot the user's data to a sealed evidence bucket. This is for legal hold purposes only — it is not given back to the user.

```bash
USER_ID="<uuid>"
SNAPSHOT_KEY="lgpd-deletion-evidence/$(date +%Y-%m)/$USER_ID.json"

psql -h <prod-host> -U readonly -d propmatch -t -A -c "
  SELECT json_build_object(
    'user', (SELECT row_to_json(u) FROM users u WHERE id = '$USER_ID'),
    'briefings_count', (SELECT count(*) FROM briefings WHERE user_id = '$USER_ID'),
    'clients_count', (SELECT count(*) FROM clients WHERE user_id = '$USER_ID'),
    'messages_count', (SELECT count(*) FROM messages m JOIN briefings b ON b.id = m.briefing_id WHERE b.user_id = '$USER_ID')
  );
" | aws s3 cp - "s3://propmatch-legal-evidence/$SNAPSHOT_KEY" --sse aws:kms
```

The evidence bucket has a 7-year lifecycle policy and is access-restricted to legal counsel.

### Step 4: Execute deletion

Run as a single transaction:

```sql
BEGIN;

-- Anonymize user record (do not DELETE; it preserves FK integrity in audit_log)
UPDATE users
SET email = 'deleted-' || id::text || '@deleted.local',
    name = 'Deleted User',
    phone = NULL,
    password_hash = '',
    deleted_at = NOW()
WHERE id = '<user_id>';

-- Cascade delete user-scoped tables
DELETE FROM briefing_results WHERE briefing_id IN (
  SELECT id FROM briefings WHERE user_id = '<user_id>'
);

DELETE FROM messages WHERE briefing_id IN (
  SELECT id FROM briefings WHERE user_id = '<user_id>'
);

DELETE FROM hitl_metrics WHERE briefing_id IN (
  SELECT id FROM briefings WHERE user_id = '<user_id>'
);

DELETE FROM briefings WHERE user_id = '<user_id>';
DELETE FROM clients WHERE user_id = '<user_id>';

-- Tokenize audit log entries (do not delete; legal retention)
UPDATE audit_log
SET actor_user_id = NULL,
    details = jsonb_set(details, '{actor_tokenized}', 'true')
WHERE actor_user_id = '<user_id>';

-- Mark the job complete
UPDATE lgpd_jobs
SET status = 'completed',
    completed_at = NOW()
WHERE id = '<job_id>';

-- Audit-log the deletion itself
INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, details, created_at)
VALUES (gen_random_uuid(), NULL, 'lgpd.delete_completed', 'user', '<user_id>',
        jsonb_build_object('job_id', '<job_id>', 'method', 'manual'),
        NOW());

COMMIT;
```

**Do not commit until you and the reviewer have inspected the changes.** Use a savepoint or run inside a `BEGIN; ... ROLLBACK;` first to verify counts.

### Step 5: Delete S3 objects

```bash
USER_ID="<uuid>"

# Property images: not deleted (not user data)
# User-uploaded files: delete
aws s3 rm "s3://propmatch-prod-uploads/users/$USER_ID/" --recursive

# DSAR exports (if any): delete
aws s3 rm "s3://propmatch-prod-exports/$USER_ID/" --recursive
```

### Step 6: Verify

```sql
-- Should return 0
SELECT count(*) FROM briefings WHERE user_id = '<user_id>';
SELECT count(*) FROM clients WHERE user_id = '<user_id>';
SELECT count(*) FROM messages m JOIN briefings b ON b.id = m.briefing_id WHERE b.user_id = '<user_id>';

-- User row should exist but be anonymized
SELECT email, name, deleted_at FROM users WHERE id = '<user_id>';
-- Expected: email = 'deleted-...@deleted.local', name = 'Deleted User', deleted_at NOT NULL

-- Audit log should be tokenized
SELECT count(*) FROM audit_log WHERE actor_user_id = '<user_id>';
-- Expected: 0

SELECT count(*) FROM audit_log WHERE details->>'actor_tokenized' = 'true' AND target_id = '<user_id>';
-- Expected: > 0
```

### Step 7: Notify the user

Send a confirmation email from `privacy@propmatch.ai`:

> Olá,
>
> Sua solicitação de exclusão de dados foi concluída em DD/MM/AAAA. Removemos seus dados pessoais do PropMatch AI conforme nossa política de privacidade e a LGPD.
>
> Mantemos por 24 meses um registro tokenizado de auditoria, conforme exigência legal. Esses dados não permitem identificá-lo pessoalmente.
>
> Se você tiver dúvidas, responda este e-mail.
>
> Equipe PropMatch AI
> privacy@propmatch.ai

### Step 8: Document in ops log

Append to `ops-log.md` (in the ops repo):

```
## YYYY-MM-DD — Manual LGPD deletion

- Job ID: <job_id>
- User ID: <user_id> (or "redacted" once tokenization completes)
- Operator: <your name>
- Reviewer: <peer name>
- Started: HH:MM
- Completed: HH:MM
- Anomalies: <none / describe>
```

## Failure modes and recovery

### "I deleted the wrong user"

Stop. Notify counsel and the user immediately. Backups retain user data for 30 days; restoration is possible but requires a coordinated effort. File an incident.

### "The transaction failed mid-way"

Postgres transactions are atomic. If the `COMMIT` failed, nothing was deleted; re-run from Step 4. If the `COMMIT` succeeded but you got a connection error before seeing the result, run Step 6 verification — the deletion likely completed.

### "S3 delete failed"

S3 deletes are best-effort. If the API errors, retry. If a particular object is locked (legal hold), escalate to counsel.

### "I don't see the lgpd_jobs row I expected"

Possible causes:
- The user cancelled within the 7-day window.
- The automated worker already processed it.
- The user submitted the request very recently (< 7 days).

Check `status` and `requested_at` carefully before doing anything.

## Approvals

This runbook was reviewed and approved by:

- [ ] Tech Lead — date
- [ ] Privacy Counsel — date (sign-off required pre-MVP-launch)
- [ ] Product Manager — date

Updates to this runbook require re-approval from counsel.
