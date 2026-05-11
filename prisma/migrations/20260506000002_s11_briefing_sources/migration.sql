-- S11: store which portals and custom URLs the broker selected for each search
-- selected_portals: text[] e.g. {'zap','vivareal'}
-- custom_urls: text[] of arbitrary imobiliária URLs

ALTER TABLE "briefings"
  ADD COLUMN IF NOT EXISTS "selected_portals" TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "custom_urls"       TEXT[]  NOT NULL DEFAULT '{}';
