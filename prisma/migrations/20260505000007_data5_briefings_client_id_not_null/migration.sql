-- DATA-5 (Sprint 5): backfill briefings.client_id → NOT NULL
-- Ticket: DATA-5 | Depends on: DATA-4
--
-- Strategy (zero-downtime, idempotent):
--   1. For each briefing without client_id, create a guest client for that user
--      with name = 'Guest – {briefing created_at date}'.
--   2. Update briefing.client_id to point to the guest.
--   3. Apply NOT NULL constraint (fast metadata change — column is already populated).
--
-- Rollback:
--   ALTER TABLE briefings ALTER COLUMN client_id DROP NOT NULL;
--   DELETE FROM clients WHERE is_guest = true AND id NOT IN (
--     SELECT DISTINCT client_id FROM briefings WHERE client_id IS NOT NULL
--   );

DO $$
DECLARE
  rec RECORD;
  guest_id UUID;
BEGIN
  FOR rec IN
    SELECT id, user_id, created_at
    FROM briefings
    WHERE client_id IS NULL
    ORDER BY user_id, created_at
  LOOP
    -- Create a guest client for this briefing's user
    INSERT INTO clients (user_id, name, is_guest, created_at)
    VALUES (
      rec.user_id,
      'Guest – ' || TO_CHAR(rec.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'),
      TRUE,
      rec.created_at
    )
    RETURNING id INTO guest_id;

    UPDATE briefings SET client_id = guest_id WHERE id = rec.id;
  END LOOP;
END;
$$;

-- Now all rows have a client_id — apply the constraint
ALTER TABLE briefings ALTER COLUMN client_id SET NOT NULL;

-- Add FK constraint (was deferred in DATA-1 until this migration)
ALTER TABLE briefings
  ADD CONSTRAINT briefings_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES clients (id)
  ON DELETE RESTRICT;
