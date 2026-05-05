-- DATA-4 (Sprint 5): clients
-- Brokers' client records — saved contacts or auto-created guests.
-- Ticket: DATA-4 | Depends on: DATA-1
--
-- State machine: active → soft_archived → pending_delete
-- OPS-3/4/5 cron jobs drive the transitions.

CREATE TYPE client_archive_status AS ENUM ('active', 'soft_archived', 'pending_delete');

CREATE TABLE clients (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  phone            TEXT,                                -- E.164, nullable for guests
  is_guest         BOOLEAN     NOT NULL DEFAULT FALSE,
  archive_status   client_archive_status NOT NULL DEFAULT 'active',
  reminder_sent_at TIMESTAMPTZ,                        -- d60 reminder for guests
  soft_archived_at TIMESTAMPTZ,                        -- d90 soft-archive timestamp
  auto_purge_at    TIMESTAMPTZ,                        -- d540 hard-delete timestamp
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- State machine: only forward transitions allowed
  CONSTRAINT clients_archive_transition CHECK (
    (archive_status = 'active')
    OR (archive_status = 'soft_archived' AND soft_archived_at IS NOT NULL)
    OR (archive_status = 'pending_delete' AND soft_archived_at IS NOT NULL)
  )
);

CREATE INDEX idx_clients_user_id        ON clients (user_id, archive_status)
  WHERE archive_status = 'active';
CREATE INDEX idx_clients_auto_purge_at  ON clients (auto_purge_at)
  WHERE auto_purge_at IS NOT NULL;
CREATE INDEX idx_clients_user_created   ON clients (user_id, created_at DESC);

-- RLS: broker sees only their own clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_owner" ON clients
  FOR ALL USING (user_id = current_app_user());
