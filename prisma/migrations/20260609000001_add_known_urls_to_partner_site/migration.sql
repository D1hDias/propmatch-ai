-- DATA-8: cache of all canonical URLs seen in the last sync
-- Prevents re-scraping listings that were discovered but failed extraction.
ALTER TABLE "partner_sites" ADD COLUMN "known_urls" TEXT[] NOT NULL DEFAULT '{}';
