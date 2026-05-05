-- AUTH-1: Initial schema — users, agencies, lgpd_jobs, audit_log
-- Implements PRD §8.1 tables for Sprint 1.
-- All timestamps TIMESTAMPTZ (UTC). Money NUMERIC(12,2) (added in later sprints).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "UserRole" AS ENUM ('broker', 'owner', 'admin');
CREATE TYPE "UserPlan" AS ENUM ('free', 'starter', 'pro');
CREATE TYPE "LgpdJobType" AS ENUM ('export', 'delete');
CREATE TYPE "LgpdJobStatus" AS ENUM (
  'requested',
  'cancellable',
  'in_progress',
  'completed',
  'failed'
);

-- ---------------------------------------------------------------------------
-- agencies
-- ---------------------------------------------------------------------------

CREATE TABLE "agencies" (
  "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
  "name"         TEXT        NOT NULL,
  "seat_count"   INT         NOT NULL,
  "owner_user_id" UUID       NOT NULL,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- unique: each owner can own exactly one agency (1-to-1 from User side)
CREATE UNIQUE INDEX "agencies_owner_user_id_key" ON "agencies"("owner_user_id");

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

CREATE TABLE "users" (
  "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
  "email"           TEXT        NOT NULL,
  "name"            TEXT        NOT NULL,
  "phone"           TEXT,
  "password_hash"   TEXT        NOT NULL,
  "role"            "UserRole"  NOT NULL DEFAULT 'broker',
  "plan"            "UserPlan"  NOT NULL DEFAULT 'free',
  "lgpd_consent_at" TIMESTAMPTZ NOT NULL,
  "agency_id"       UUID,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_agency_id_idx" ON "users"("agency_id");

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_updated_at"
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- lgpd_jobs
-- ---------------------------------------------------------------------------

CREATE TABLE "lgpd_jobs" (
  "id"                  UUID            NOT NULL DEFAULT gen_random_uuid(),
  "user_id"             UUID            NOT NULL,
  "job_type"            "LgpdJobType"   NOT NULL,
  "status"              "LgpdJobStatus" NOT NULL DEFAULT 'requested',
  "requested_at"        TIMESTAMPTZ     NOT NULL DEFAULT now(),
  "completed_at"        TIMESTAMPTZ,
  "cancellation_token"  VARCHAR(64),

  CONSTRAINT "lgpd_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lgpd_jobs_user_id_status_idx" ON "lgpd_jobs"("user_id", "status");

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------

CREATE TABLE "audit_log" (
  "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" UUID,
  "action"        TEXT        NOT NULL,
  "target_type"   TEXT,
  "target_id"     UUID,
  "details"       JSONB,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_log_actor_created_idx" ON "audit_log"("actor_user_id", "created_at" DESC);
CREATE INDEX "audit_log_action_created_idx" ON "audit_log"("action", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- Foreign keys (applied after all tables exist)
-- ---------------------------------------------------------------------------

ALTER TABLE "agencies"
  ADD CONSTRAINT "agencies_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "users"
  ADD CONSTRAINT "users_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lgpd_jobs"
  ADD CONSTRAINT "lgpd_jobs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS baseline (policies are added in AUTH-3)
-- ---------------------------------------------------------------------------

ALTER TABLE "users"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agencies"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lgpd_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;

-- Superuser / service-role bypass so migrations and cron jobs still work
-- Actual per-row policies are wired in AUTH-3.
