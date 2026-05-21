-- DATA-7: Persistent partner site profiles for configurable scraping strategies.
-- Adds partner_sites table and unique dedup constraint on properties.

-- CreateTable
CREATE TABLE "partner_sites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discovery_strategy" TEXT NOT NULL DEFAULT 'map_then_scrape',
    "property_url_patterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "listing_url_patterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "include_paths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclude_paths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "crawl_depth_default" INTEGER NOT NULL DEFAULT 2,
    "crawl_limit_default" INTEGER NOT NULL DEFAULT 60,
    "ignore_query_params" BOOLEAN NOT NULL DEFAULT false,
    "needs_interact" BOOLEAN NOT NULL DEFAULT false,
    "needs_javascript" BOOLEAN NOT NULL DEFAULT false,
    "uses_sitemap" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "last_discovered_at" TIMESTAMPTZ,
    "last_scraped_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_sites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_sites_user_id_domain_key" ON "partner_sites"("user_id", "domain");
CREATE INDEX "partner_sites_user_id_active_idx" ON "partner_sites"("user_id", "active");

-- AddForeignKey
ALTER TABLE "partner_sites"
    ADD CONSTRAINT "partner_sites_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deduplicate existing properties before adding unique constraint.
-- Keep the row with the latest last_seen_at; reassign child rows first.
WITH dupes AS (
    SELECT
        id,
        geohash7,
        address_normalized,
        last_seen_at,
        ROW_NUMBER() OVER (
            PARTITION BY geohash7, address_normalized
            ORDER BY last_seen_at DESC
        ) AS rn
    FROM properties
    WHERE geohash7 IS NOT NULL
),
survivors AS (
    SELECT DISTINCT ON (d.geohash7, d.address_normalized)
        d.id AS survivor_id,
        d2.id AS dupe_id
    FROM dupes d
    JOIN dupes d2
        ON d.geohash7 = d2.geohash7
       AND d.address_normalized = d2.address_normalized
       AND d.rn = 1
       AND d2.rn > 1
)
-- Reassign property_sources to the surviving property
UPDATE property_sources
SET property_id = survivors.survivor_id
FROM survivors
WHERE property_id = survivors.dupe_id;

-- Reassign briefing_results to the surviving property
WITH dupes AS (
    SELECT
        id,
        geohash7,
        address_normalized,
        last_seen_at,
        ROW_NUMBER() OVER (
            PARTITION BY geohash7, address_normalized
            ORDER BY last_seen_at DESC
        ) AS rn
    FROM properties
    WHERE geohash7 IS NOT NULL
),
survivors AS (
    SELECT DISTINCT ON (d.geohash7, d.address_normalized)
        d.id AS survivor_id,
        d2.id AS dupe_id
    FROM dupes d
    JOIN dupes d2
        ON d.geohash7 = d2.geohash7
       AND d.address_normalized = d2.address_normalized
       AND d.rn = 1
       AND d2.rn > 1
)
DELETE FROM briefing_results
WHERE property_id IN (SELECT dupe_id FROM survivors);

-- Delete duplicate property rows (keep survivors)
DELETE FROM properties
WHERE geohash7 IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (geohash7, address_normalized) id
    FROM properties
    WHERE geohash7 IS NOT NULL
    ORDER BY geohash7, address_normalized, last_seen_at DESC
  );

-- Unique dedup constraint on properties (geohash7 + address_normalized).
-- NULLs are treated as distinct in PostgreSQL unique indexes, so rows with
-- geohash7 = NULL can coexist (ungeocoded properties won't be deduplicated).
CREATE UNIQUE INDEX "properties_geohash7_address_normalized_key"
    ON "properties"("geohash7", "address_normalized");
