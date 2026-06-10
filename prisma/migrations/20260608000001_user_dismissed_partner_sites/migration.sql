-- DATA-8: Per-broker partner site dismissal
-- Brokers can remove sites from their personal list without deleting from global DB.
-- Ticket: DATA-8 (partner site management)
ALTER TABLE "users" ADD COLUMN "dismissed_partner_site_ids" TEXT[] NOT NULL DEFAULT '{}';
