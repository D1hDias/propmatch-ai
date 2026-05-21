-- DATA-8: Sync inventory columns for partner sites
-- Adds periodic sync tracking and per-site inventory stats.
-- Adds partner_site_id FK on property_sources for delta sync.

-- partner_sites: sync control columns
ALTER TABLE partner_sites
  ADD COLUMN sync_interval_days  INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN listing_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN sync_status         TEXT    NOT NULL DEFAULT 'idle';

-- property_sources: link back to the partner site that produced the row
ALTER TABLE property_sources
  ADD COLUMN partner_site_id UUID REFERENCES partner_sites(id) ON DELETE SET NULL;

CREATE INDEX idx_property_sources_partner_site ON property_sources(partner_site_id);
