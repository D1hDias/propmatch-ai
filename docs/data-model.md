# Data Model

This is the engineering reference for PropMatch AI's PostgreSQL schema. It tracks the PRD §8 specification but is the operational source of truth — schema changes go here first.

## Conventions

- Primary keys: UUID v7 (time-ordered) for index locality. Generated server-side.
- IDs in API responses are prefixed: `brf_{uuid}`, `clt_{uuid}`, `prp_{uuid}`. Internal storage is the raw UUID.
- All timestamps: `TIMESTAMPTZ`, stored UTC.
- Money: `NUMERIC(12,2)` for property prices and subscription costs. Never `FLOAT`.
- Soft-delete columns are explicit (`archive_status`, `deleted_at`); we do not use a generic "is_deleted" pattern.
- All user-scoped tables have a `user_id` column and an RLS policy. See [security.md](security.md) and ADR-0005.

## Tables

### `users`

Authenticated users. One row per broker, owner, or admin.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `email` | TEXT UNIQUE NOT NULL | Lowercased on write |
| `name` | TEXT NOT NULL | |
| `phone` | TEXT | E.164 format. Nullable for admins |
| `password_hash` | TEXT NOT NULL | argon2id |
| `role` | ENUM | `broker` / `owner` / `admin` |
| `agency_id` | UUID FK | nullable; references `agencies(id)` |
| `plan` | ENUM | `free` / `starter` / `pro` |
| `lgpd_consent_at` | TIMESTAMPTZ NOT NULL | Consent capture is mandatory |
| `created_at` | TIMESTAMPTZ NOT NULL | DEFAULT now() |
| `updated_at` | TIMESTAMPTZ NOT NULL | trigger-maintained |

**Indexes:**
- `users(email)` UNIQUE
- `users(agency_id)` for owner-team queries

**RLS:** A user can `SELECT` their own row. An owner can `SELECT` rows where `agency_id` matches and broker has opted in (separate consent table, Phase 2). An admin can `SELECT` all.

### `agencies`

Optional grouping for multi-broker offices.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `name` | TEXT NOT NULL | |
| `owner_user_id` | UUID FK NOT NULL | `users(id)` |
| `seat_count` | INT NOT NULL | Billing-enforced |
| `created_at` | TIMESTAMPTZ NOT NULL | |

### `clients`

Brokers' clients — real or guest.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_id` | UUID FK NOT NULL | RLS column |
| `name` | TEXT NOT NULL | "Guest – {date}" for guests |
| `phone` | TEXT | E.164. Nullable for guests |
| `is_guest` | BOOLEAN NOT NULL DEFAULT false | |
| `archive_status` | ENUM NOT NULL DEFAULT 'active' | `active` / `soft_archived` / `pending_delete` |
| `reminder_sent_at` | TIMESTAMPTZ | Day-60 reminder for guests |
| `soft_archived_at` | TIMESTAMPTZ | Day-90 for guests with briefings |
| `auto_purge_at` | TIMESTAMPTZ | Day-540 for soft-archived guests |
| `notes` | TEXT | |
| `created_at` | TIMESTAMPTZ NOT NULL | |

**State machine:** `active → soft_archived → pending_delete`. Skipping not allowed; enforced via CHECK constraint on transitions.

**Indexes:**
- `clients(user_id, archive_status)` partial on `archive_status = 'active'` (the common query path)
- `clients(auto_purge_at)` for the retention cron

**RLS:** Standard `user_id` policy.

### `briefings`

The core entity. One row per broker-submitted briefing.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_id` | UUID FK NOT NULL | RLS |
| `client_id` | UUID FK **NOT NULL** | Mandatory association |
| `raw_text` | TEXT NOT NULL | 10–2,000 chars |
| `raw_text_purge_at` | TIMESTAMPTZ NOT NULL | DEFAULT now() + interval '18 months' |
| `extracted_criteria` | JSONB | GIN-indexed |
| `extraction_confidence` | NUMERIC(4,3) | 0.000–1.000 |
| `review_status` | ENUM | `not_required` / `pending` / `approved` / `corrected` / `overflow_broker_edit` |
| `review_mode` | ENUM | `hitl` / `broker_direct_edit` / `auto_approved` |
| `reviewed_by` | UUID FK | nullable; internal reviewer ID |
| `auto_widen_used` | BOOLEAN NOT NULL DEFAULT false | |
| `status` | ENUM | `extracting` / `searching` / `ready` / `failed` |
| `created_at` | TIMESTAMPTZ NOT NULL | |

**Constraints:**
- `client_id` NOT NULL — enforced at DB and application layer.
- `extraction_confidence BETWEEN 0 AND 1`
- `LENGTH(raw_text) BETWEEN 10 AND 2000`

**Indexes:**
- `briefings(user_id, created_at DESC)` for history page
- `briefings(client_id)` for per-client history
- `briefings(raw_text_purge_at)` partial WHERE `raw_text IS NOT NULL` for retention cron
- GIN on `extracted_criteria` for criteria search

### `properties`

Canonical property records, post-deduplication.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `address_normalized` | TEXT | Lowercased, accent-stripped, format-canonicalized |
| `geohash` | VARCHAR(8) | precision-7 geohash |
| `city` | TEXT | |
| `neighborhood` | TEXT | |
| `price` | NUMERIC(12,2) | CHECK > 0 AND < 1e9 |
| `bedrooms` | SMALLINT | |
| `area_m2` | NUMERIC(8,2) | |
| `amenities` | JSONB | |
| `description` | TEXT | indexed in OpenSearch |
| `primary_image_phash` | VARCHAR(16) | nullable until Phase 2 |
| `last_seen_at` | TIMESTAMPTZ NOT NULL | |
| `created_at` | TIMESTAMPTZ NOT NULL | |

**Indexes:**
- `properties(geohash, bedrooms)` for dedup query
- `properties(city, neighborhood)` for filtering
- `properties(last_seen_at)` for retention/cleanup
- GIN on `amenities`

### `property_sources`

One property → many source listings. Tracks which portals the same property appears on.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `property_id` | UUID FK NOT NULL | |
| `source` | ENUM | `partner_a` / `portal_x` / `partner_upload` / etc. |
| `source_url` | TEXT NOT NULL | |
| `source_listing_id` | TEXT | as known by the source |
| `commission_pct` | NUMERIC(4,2) | partner-upload only |
| `last_fetched_at` | TIMESTAMPTZ NOT NULL | |

**Indexes:**
- `property_sources(property_id)` for "all sources for this property"
- `property_sources(source, source_listing_id)` UNIQUE for upserts

### `briefing_results`

Materialized search results per briefing. Stores broker selections and notes.

| Column | Type | Notes |
|--------|------|-------|
| `briefing_id` | UUID FK NOT NULL | |
| `property_id` | UUID FK NOT NULL | |
| `fit_score` | SMALLINT | 0–100 |
| `selected` | BOOLEAN NOT NULL DEFAULT false | broker selection |
| `personal_note` | TEXT | nullable; max 200 chars |
| PRIMARY KEY | (`briefing_id`, `property_id`) | |

### `messages`

WhatsApp messages generated from briefings.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `briefing_id` | UUID FK NOT NULL | |
| `client_id` | UUID FK NOT NULL | |
| `formatted_text` | TEXT NOT NULL | |
| `delivery_method` | ENUM | `clipboard` / `whatsapp_api` |
| `delivery_status` | ENUM | `pending` / `copied` / `sent` / `delivered` / `read` / `failed` |
| `sent_at` | TIMESTAMPTZ | |
| `phone_hash` | VARCHAR(64) | populated 90d after `sent_at`; raw phone purged |

### `hitl_metrics`

HITL review SLA tracking. One row per HITL-routed briefing.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `briefing_id` | UUID FK NOT NULL | |
| `queued_at` | TIMESTAMPTZ NOT NULL | |
| `reviewed_at` | TIMESTAMPTZ | nullable until reviewed |
| `review_duration_ms` | INT | derived; computed at review time |
| `reviewer_id` | UUID FK | |
| `outcome` | ENUM | `approved` / `corrected` / `overflow_redirect` |

### `lgpd_jobs`

DSAR audit trail. One row per export or deletion request.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_id` | UUID FK NOT NULL | |
| `job_type` | ENUM | `export` / `delete` |
| `status` | ENUM | `requested` / `cancellable` / `in_progress` / `completed` / `failed` |
| `requested_at` | TIMESTAMPTZ NOT NULL | |
| `completed_at` | TIMESTAMPTZ | nullable |
| `cancellation_token` | VARCHAR(64) | for the 7-day grace period |

### `audit_log`

Compliance and security audit trail.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `actor_user_id` | UUID FK | tokenized after 12 months |
| `action` | TEXT NOT NULL | e.g., `user.signup`, `lgpd.delete_requested` |
| `target_type` | TEXT | e.g., `user`, `briefing` |
| `target_id` | UUID | |
| `details` | JSONB | structured context |
| `created_at` | TIMESTAMPTZ NOT NULL | |

**Indexes:**
- `audit_log(actor_user_id, created_at DESC)`
- `audit_log(action, created_at DESC)`

**Retention:** 24 months (legal minimum). Not user-deletable.

## Validation rules

Application-level validations that complement DB constraints:

- `briefings.raw_text`: 10–2,000 chars, NOT NULL.
- `briefings.client_id`: NOT NULL — enforced at app + DB level.
- `briefings.extraction_confidence`: BETWEEN 0 AND 1.
- `clients.archive_status`: state machine `active → soft_archived → pending_delete`; no skipping.
- `properties.price`: > 0, ≤ 1e9.
- `users.phone`: regex `^\+\d{10,15}$`.
- `briefing_results.fit_score`: BETWEEN 0 AND 100.
- All timestamps stored UTC; rendered in `America/Sao_Paulo` client-side by default.

## Storage estimates

| Object | MVP (W10) | Beta (M4) | GA (M8) | Year-1 (M12) |
|--------|-----------|-----------|---------|---------------|
| Properties | 5K | 50K | 500K | 5M |
| Property sources | 12K | 150K | 1.5M | 18M |
| Property images (S3) | ~10 GB | ~100 GB | ~1 TB | ~10 TB |
| Briefings | 5K | 90K | 700K | 2M |
| OpenSearch index | ~1 GB | ~5 GB | ~12 GB | ~25 GB |

## Migration policy

- Every migration is reversible.
- Migrations include a comment with the ticket ID and a one-line rationale.
- Schema changes go through the data model PR review explicitly tagged with `schema`.
- Online migrations (no downtime) are mandatory once we leave Beta. Use Postgres-friendly patterns: add nullable column → backfill → set NOT NULL.
- See ADR-0001 for the migration tool decision.

## Tables by sprint

| Sprint | Tables landing |
|--------|----------------|
| S1 | `users`, `agencies`, `lgpd_jobs`, `audit_log` |
| S2 | `briefings` (without `client_id` enforcement until S5), `hitl_metrics` |
| S3 | `properties`, `property_sources` |
| S4 | `briefing_results` |
| S5 | `clients`, `briefings.client_id` constraint enabled |
| S6 | `messages` |
| S7+ | retention cron jobs, partner upload tables (Phase 2) |
