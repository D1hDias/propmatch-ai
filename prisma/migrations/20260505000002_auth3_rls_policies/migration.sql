-- AUTH-3: Row-Level Security policies for Sprint 1 tables.
-- Pattern documented in docs/adr/0005-rls-pattern.md.
-- Background jobs connect as a BYPASSRLS service role; this file wires the per-row policies.

-- ---------------------------------------------------------------------------
-- Session variable helper functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_app_user() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN current_setting('app.current_user_id', true)::uuid;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'app.current_user_id not set in this transaction';
END;
$$;

CREATE OR REPLACE FUNCTION current_app_role() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN COALESCE(current_setting('app.current_user_role', true), 'broker');
END;
$$;

-- ---------------------------------------------------------------------------
-- users — broker sees only self; admin sees all
-- ---------------------------------------------------------------------------

-- FORCE ROW LEVEL SECURITY so even the table owner is subject to policies.
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

CREATE POLICY "users_self_select" ON "users"
  FOR SELECT
  USING (id = current_app_user() OR current_app_role() = 'admin');

CREATE POLICY "users_self_update" ON "users"
  FOR UPDATE
  USING (id = current_app_user())
  WITH CHECK (id = current_app_user());

-- INSERT is handled by the service role (signup path). No row policy needed for INSERT
-- from application code because signup runs before the user exists.

-- ---------------------------------------------------------------------------
-- agencies — owner sees their own agency; admin sees all
-- ---------------------------------------------------------------------------

ALTER TABLE "agencies" FORCE ROW LEVEL SECURITY;

CREATE POLICY "agencies_owner_select" ON "agencies"
  FOR SELECT
  USING (owner_user_id = current_app_user() OR current_app_role() = 'admin');

CREATE POLICY "agencies_owner_update" ON "agencies"
  FOR UPDATE
  USING (owner_user_id = current_app_user())
  WITH CHECK (owner_user_id = current_app_user());

-- ---------------------------------------------------------------------------
-- refresh_tokens — user sees only their own tokens; never readable in practice
-- (the service layer only touches tokens by hash, not by user query)
-- ---------------------------------------------------------------------------

ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY "refresh_tokens_owner" ON "refresh_tokens"
  FOR ALL
  USING (user_id = current_app_user() OR current_app_role() = 'admin')
  WITH CHECK (user_id = current_app_user());

-- ---------------------------------------------------------------------------
-- lgpd_jobs — user sees only their own requests; admin sees all
-- ---------------------------------------------------------------------------

ALTER TABLE "lgpd_jobs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "lgpd_jobs_owner" ON "lgpd_jobs"
  FOR ALL
  USING (user_id = current_app_user() OR current_app_role() = 'admin')
  WITH CHECK (user_id = current_app_user());

-- ---------------------------------------------------------------------------
-- audit_log — read-only for admin; brokers cannot query it
-- (the application always writes via the service role, never via RLS user context)
-- ---------------------------------------------------------------------------

ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_admin_read" ON "audit_log"
  FOR SELECT
  USING (current_app_role() = 'admin');

-- audit_log has no UPDATE or DELETE policy intentionally: records are immutable.

-- ---------------------------------------------------------------------------
-- Service role for background jobs (crons, search, messaging)
-- Creates the role if it doesn't exist; grants BYPASSRLS.
-- In production this role's password is managed via the secrets system (ADR-0009).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'propmatch_service') THEN
    CREATE ROLE propmatch_service WITH LOGIN BYPASSRLS;
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO propmatch_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO propmatch_service;
