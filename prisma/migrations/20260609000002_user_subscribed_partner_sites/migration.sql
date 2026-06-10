-- Opt-in partner site model: users only see agencies they explicitly added.
-- Admin-pre-registered sites are invisible until the broker subscribes.
ALTER TABLE "users" ADD COLUMN "subscribed_partner_site_ids" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: users who already created sites remain subscribed (backward compat).
UPDATE "users" u
SET subscribed_partner_site_ids = ARRAY(
  SELECT ps.id::text FROM partner_sites ps WHERE ps.user_id = u.id
);
