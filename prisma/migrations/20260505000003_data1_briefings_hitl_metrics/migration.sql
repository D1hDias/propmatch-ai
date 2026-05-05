-- DATA-1: briefings and hitl_metrics tables for Sprint 2.
-- client_id is nullable here; NOT NULL constraint is enforced in DATA-5 (Sprint 5)
-- after the clients table and backfill migration are in place.
-- raw_text retention: 18 months enforced by OPS-1 cron (Sprint 2).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "BriefingReviewStatus" AS ENUM (
  'not_required',
  'pending',
  'approved',
  'corrected',
  'overflow_broker_edit'
);

CREATE TYPE "BriefingReviewMode" AS ENUM (
  'hitl',
  'broker_direct_edit',
  'auto_approved'
);

CREATE TYPE "BriefingStatus" AS ENUM (
  'extracting',
  'searching',
  'ready',
  'failed'
);

CREATE TYPE "HitlOutcome" AS ENUM (
  'approved',
  'corrected',
  'overflow_redirect'
);

-- ---------------------------------------------------------------------------
-- briefings
-- ---------------------------------------------------------------------------

CREATE TABLE "briefings" (
  "id"                    UUID                   NOT NULL DEFAULT gen_random_uuid(),
  "user_id"               UUID                   NOT NULL,
  "client_id"             UUID,                  -- NOT NULL enforced in DATA-5
  "raw_text"              TEXT                   NOT NULL,
  "raw_text_purge_at"     TIMESTAMPTZ            NOT NULL DEFAULT now() + interval '18 months',
  "extracted_criteria"    JSONB,
  "extraction_confidence" NUMERIC(4, 3),
  "review_status"         "BriefingReviewStatus" NOT NULL DEFAULT 'pending',
  "review_mode"           "BriefingReviewMode",
  "reviewed_by"           UUID,
  "auto_widen_used"       BOOLEAN                NOT NULL DEFAULT false,
  "status"                "BriefingStatus"       NOT NULL DEFAULT 'extracting',
  "created_at"            TIMESTAMPTZ            NOT NULL DEFAULT now(),

  CONSTRAINT "briefings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "briefings_raw_text_length"
    CHECK (char_length("raw_text") BETWEEN 10 AND 2000),
  CONSTRAINT "briefings_confidence_range"
    CHECK ("extraction_confidence" IS NULL
      OR ("extraction_confidence" >= 0 AND "extraction_confidence" <= 1))
);

CREATE INDEX "briefings_user_id_created_at_idx"
  ON "briefings"("user_id", "created_at" DESC);

CREATE INDEX "briefings_client_id_idx"
  ON "briefings"("client_id");

-- Partial index: only rows where raw_text still exists need purge processing
CREATE INDEX "briefings_raw_text_purge_at_idx"
  ON "briefings"("raw_text_purge_at")
  WHERE "raw_text" IS NOT NULL;

-- GIN index for criteria search (used from Sprint 4 onwards)
CREATE INDEX "briefings_extracted_criteria_gin"
  ON "briefings" USING GIN ("extracted_criteria");

ALTER TABLE "briefings"
  ADD CONSTRAINT "briefings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "briefings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "briefings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "briefings_owner" ON "briefings"
  FOR ALL
  USING ("user_id" = current_app_user() OR current_app_role() = 'admin')
  WITH CHECK ("user_id" = current_app_user());

-- ---------------------------------------------------------------------------
-- hitl_metrics
-- ---------------------------------------------------------------------------

CREATE TABLE "hitl_metrics" (
  "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
  "briefing_id"        UUID         NOT NULL,
  "queued_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "reviewed_at"        TIMESTAMPTZ,
  "review_duration_ms" INT,
  "reviewer_id"        UUID,
  "outcome"            "HitlOutcome",

  CONSTRAINT "hitl_metrics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hitl_metrics_briefing_id_fkey"
    FOREIGN KEY ("briefing_id") REFERENCES "briefings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "hitl_metrics_briefing_id_idx" ON "hitl_metrics"("briefing_id");

ALTER TABLE "hitl_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hitl_metrics" FORCE ROW LEVEL SECURITY;

-- HITL reviewers are internal; brokers should not query this table directly.
-- Admin-only read; writes come from the HITL worker (service role).
CREATE POLICY "hitl_metrics_admin" ON "hitl_metrics"
  FOR ALL
  USING (current_app_role() = 'admin');

-- Grant service role access (BYPASSRLS already covers it, but explicit for clarity)
GRANT SELECT, INSERT, UPDATE ON "briefings"    TO propmatch_service;
GRANT SELECT, INSERT, UPDATE ON "hitl_metrics" TO propmatch_service;
