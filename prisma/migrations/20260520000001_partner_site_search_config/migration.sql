-- DATA-8: Add search_config to partner_sites for smart filtered search
-- Enables site-specific search strategies (karioca_api, markers_extract)

ALTER TABLE "partner_sites" ADD COLUMN "search_config" JSONB;
