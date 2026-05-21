-- DATA-7 v2: Operational controls, seed URLs, and profile lock for partner_sites.
-- Also replaces the unique constraint on properties with a plain index — dedup
-- is now done at service level to avoid false merges between units in the same
-- building that share the same geohash7 + normalised address prefix.
-- Ticket: DATA-7-v2

-- ── 1. Add new columns to partner_sites ──────────────────────────────────────

ALTER TABLE partner_sites
  -- Concrete search-result URLs provided by the broker (e.g. already-filtered pages).
  -- Strategy uses these as entry points instead of base_url.
  ADD COLUMN IF NOT EXISTS seed_urls TEXT[] NOT NULL DEFAULT '{}',
  -- Last entry URLs computed and used by a search run (diagnostic, not user-editable).
  ADD COLUMN IF NOT EXISTS search_entry_urls TEXT[] NOT NULL DEFAULT '{}',
  -- When TRUE, discovery() will not overwrite URL patterns — manual config is preserved.
  ADD COLUMN IF NOT EXISTS profile_locked BOOLEAN NOT NULL DEFAULT FALSE,
  -- Timestamp of the last successful scrape (at least one listing returned).
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
  -- Timestamp of the most recent scrape failure.
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
  -- Number of consecutive scrape failures since last success.
  -- Scraping is skipped when this reaches 5.
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
  -- Set at the start of discoverPartnerSite(), cleared at the end.
  -- Acts as an idempotency lock to prevent concurrent discovery runs.
  ADD COLUMN IF NOT EXISTS discovery_locked_at TIMESTAMPTZ;

-- ── 2. Replace unique constraint on properties with a plain index ─────────────
-- The two-column unique (geohash7, address_normalized) can merge different
-- apartments in the same building when the address lacks a unit suffix.
-- Service-level dedup (findFirst → update-or-create) is safer and can later
-- be extended with fuzzy matching.

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_geohash7_address_normalized_key;

CREATE INDEX IF NOT EXISTS properties_geohash7_address_normalized_idx
  ON properties (geohash7, address_normalized)
  WHERE geohash7 IS NOT NULL;
