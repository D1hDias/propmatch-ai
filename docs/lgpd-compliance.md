# LGPD Compliance

PropMatch AI operates in Brazil and processes personal data covered by the Lei Geral de Proteção de Dados (LGPD, Federal Law 13.709/2018). This document is the operational playbook. Failure to comply is a launch blocker and an existential risk to the business.

## Legal basis

We process personal data under two LGPD bases:

- **Consent** (Art. 7, I) — for processing the broker's account data, briefings, and client records they create.
- **Legitimate interest** (Art. 7, IX) — for security, fraud prevention, and audit logging.

Brokers explicitly consent at signup via a separate checkbox (not bundled with Terms of Service). Consent is timestamped on `users.lgpd_consent_at` and cannot be NULL.

## Data subjects

Two categories of data subjects exist in our system:

1. **Brokers** — they sign up, consent, and are users of the platform.
2. **End clients of brokers** — they are *not* users of our platform. The broker enters their name and phone (in saved or guest form). We process this data on the broker's behalf as an operator (operador) under LGPD; the broker is the controller (controlador).

The broker-as-controller relationship is documented in our Terms of Service. Brokers are responsible for obtaining their own clients' consent for being entered into a CRM tool.

## Personal data we process

| Data | Subject | Sensitivity | Purpose |
|------|---------|-------------|---------|
| Email | Broker | Standard | Authentication, communication |
| Name | Broker | Standard | Display, billing |
| Phone | Broker | Standard | 2FA (Phase 2), recovery |
| Password (hashed) | Broker | High | Authentication |
| Briefing raw text | Broker (and inferred end-client) | Standard | Core service |
| Client name + phone | End client (via broker) | Standard | Core service |
| WhatsApp message logs | End client (via broker) | Standard | Delivery tracking |
| IP addresses | Broker | Standard | Security, rate limiting |

We do **not** process sensitive personal data (Art. 5, II) — no health, racial, religious, sexual, or biometric data.

## Retention

Retention is enforced by automated cron jobs in `services/auth-svc/jobs/`. The schedule is daily at 03:00 UTC.

| Data | Retention | Anonymization | Deletion trigger |
|------|-----------|----------------|-------------------|
| `briefings.raw_text` | 18 months | After 18mo: `extracted_criteria` retained, `raw_text` set NULL | User request: 30 days |
| `clients` (saved) | While active + 12mo | Phone hashed in analytics exports | User request: 30 days |
| Guest clients with briefings | Soft-archive at day 90; full delete at day 540 | Same as briefings | User request: 30 days |
| Guest clients without briefings | Hard delete at day 90 | N/A | Auto |
| Property images (S3) | 6 months from `last_seen_at` | N/A | S3 lifecycle policy |
| Partner spreadsheets (Phase 2) | 90 days from upload | Source PII redacted post-import | Cron + user-initiated |
| WhatsApp message logs | 6 months | Phone hashed after 90 days | User request: 30 days |
| `audit_log` | 24 months (legal minimum) | Actor IDs tokenized after 12mo | Not user-deletable |
| `lgpd_jobs` | 24 months | N/A | Not user-deletable |

### How retention is enforced

A nightly cron job (`retention_enforcer`) runs the following queries in a single transaction per table:

```sql
-- Example: briefing raw_text purge
UPDATE briefings
SET raw_text = NULL
WHERE raw_text_purge_at < NOW()
  AND raw_text IS NOT NULL;

-- Guest client soft-archive
UPDATE clients
SET archive_status = 'soft_archived',
    soft_archived_at = NOW(),
    auto_purge_at = NOW() + interval '450 days'
WHERE is_guest = true
  AND archive_status = 'active'
  AND created_at < NOW() - interval '90 days'
  AND EXISTS (SELECT 1 FROM briefings WHERE briefings.client_id = clients.id);

-- Guest client hard-delete (no briefings)
DELETE FROM clients
WHERE is_guest = true
  AND archive_status = 'active'
  AND created_at < NOW() - interval '90 days'
  AND NOT EXISTS (SELECT 1 FROM briefings WHERE briefings.client_id = clients.id);

-- Soft-archived guest hard-delete (after 540 days)
DELETE FROM clients
WHERE archive_status = 'soft_archived'
  AND auto_purge_at < NOW();
```

Each cron run logs to `audit_log` with the row count affected.

## Data subject rights (DSAR)

LGPD grants data subjects several rights. Our implementation:

### Right to access (Art. 18, I)

Endpoint: `POST /api/v1/lgpd/export` (ships Sprint 7).

In the MVP grace period (W10 to S7), exports are handled manually per the [manual export runbook](ops/lgpd-manual-export.md). Counsel has signed off on this process.

When the endpoint ships, it creates an `lgpd_jobs` row with `job_type = 'export'`, status `requested`. An async worker compiles all data the user has access to: profile, briefings, clients, messages, audit log entries where they are the actor. Output is a ZIP file uploaded to S3, accessible via a 72-hour signed URL emailed to the user.

SLA: 7 days.

### Right to deletion (Art. 18, VI)

Endpoint: `POST /api/v1/lgpd/delete` (MVP-blocking, ships Sprint 1).

Flow:
1. User submits request. We create `lgpd_jobs` row, status `cancellable`, with a `cancellation_token`.
2. Confirmation email sent with cancellation link valid 7 days.
3. After 7 days (no cancellation), status moves to `in_progress`.
4. Async worker performs deletion within 30 days, transitioning status to `completed`.

What deletion does:
- `users` row marked deleted (email anonymized to `deleted-{uuid}@deleted.local`, `name` to "Deleted User", password hash cleared).
- All `briefings`, `clients`, `messages`, `briefing_results` for that user: deleted.
- Property records are not deleted — they're not the user's data.
- `audit_log` entries: actor ID tokenized, retained for 24-month legal minimum.
- S3 objects (uploaded files, exports): deleted.

What deletion does **not** do:
- Aggregated analytics: data is anonymized but counts remain.
- Backups: deleted from active storage; backups expire on rolling 30-day window.
- Audit log: retained per legal requirement.

The `audit_log` retention is documented in the privacy policy and explained in the deletion confirmation email.

### Right to correction (Art. 18, III)

Brokers can update their own profile via the settings page. For corrections to derived data (extracted criteria, audit log entries), brokers email privacy@propmatch.ai. Manual handling is acceptable; volume is expected to be very low.

### Right to data portability (Art. 18, V)

Same endpoint as access. Export format is JSON in a structured ZIP, with a top-level `manifest.json` describing the contents.

### Right to revoke consent (Art. 8, §5)

Revoking consent terminates the broker's account. Same flow as deletion. We do not maintain accounts without consent.

### Right to be informed about sharing (Art. 18, VII)

We do not share personal data with third parties for marketing. We use the following processors:
- AWS / Cloudflare: hosting and CDN
- Anthropic: LLM extraction (zero-retention agreement; briefing text is not retained by Anthropic)
- Stripe: billing
- Datadog, Sentry: observability
- Meta (WhatsApp Cloud API, Phase 2): message delivery

This list is in our privacy policy. Updates go through the privacy policy update process (broker notified by email, 30 days notice).

## DPIA — Data Protection Impact Assessment

A DPIA is on file with privacy counsel. It was completed before MVP launch and reviewed annually thereafter. It covers:

- Data flow mapping (broker → briefing-svc → Claude → search-svc → messaging-svc).
- Risk assessment (account takeover, tenant breach, prompt injection, retention failure).
- Mitigations in place (RLS, audit logging, automated retention).
- Residual risk acceptance signed by leadership.

The DPIA lives in `docs/legal/dpia.md` (not in this docs folder; restricted access).

## Manual deletion grace period

For the first 14 days post-launch, the automated deletion worker is fully shipped but operations also runs the manual deletion playbook in parallel as a verification check. After 14 days of clean automated runs (audit-log evidence reviewed by counsel), the manual process is decommissioned.

The playbook is in [docs/ops/lgpd-manual-deletion.md](ops/lgpd-manual-deletion.md). Counsel signed off pre-launch via the dry-run process described in PRD §5.5.

## Notification of breach

Per LGPD Art. 48, breaches affecting data subjects' rights and freedoms must be reported to the ANPD (Autoridade Nacional de Proteção de Dados) within a "reasonable" period (interpreted by counsel as 72 hours for material breaches). Affected data subjects must also be notified.

Internal procedure:
1. Detection → on-call paged.
2. Containment → access cut, evidence preserved.
3. Assessment → counsel engaged within 4 hours.
4. Notification decision → made within 24 hours.
5. ANPD report drafted with counsel.
6. Affected user notification.
7. Post-mortem.

The full breach-response runbook is in `docs/ops/breach-response.md`.

## Privacy policy

Public-facing: `https://propmatch.ai/privacy`. Updated by the legal team. Engineering does not modify the privacy policy directly; changes go through the legal review process.

The policy explicitly covers: data collected, purposes, legal bases, retention, sharing, rights, and contact information for the DPO (privacy@propmatch.ai).

## DPO and contact

Data Protection Officer: privacy@propmatch.ai
Address (legal): see footer of public site.

LGPD-related correspondence is logged and acknowledged within 5 business days.

## Engineering checklist for LGPD-touching changes

- [ ] Does this change introduce new personal data fields? If yes, update the table above and the privacy policy.
- [ ] Does this change introduce new processing? If yes, the legal basis is documented.
- [ ] Does this change introduce new retention requirements? If yes, the retention cron is updated.
- [ ] Does this change introduce new third-party data sharing? If yes, the processor list is updated and a DPA is in place.
- [ ] Does this change touch the deletion or export flows? If yes, the manual playbook is reviewed and counsel re-consulted if needed.
- [ ] Does this change log new data? If yes, PII rules are respected (no raw text, no phone, no email beyond what was already there).
