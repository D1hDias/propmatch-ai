-- DATA-8 v2: Demand-based sync TTL
-- Adds search_count to partner_sites so syncIntervalDays can auto-adjust
-- based on how often a site is queried (popular sites stay fresher).
-- Also resets the default syncIntervalDays from 3 to 7; the auto-adjust
-- logic in run-search.ts will shorten it for high-demand sites.

ALTER TABLE partner_sites
  ADD COLUMN search_count INTEGER NOT NULL DEFAULT 0;
