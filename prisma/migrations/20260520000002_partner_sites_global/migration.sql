-- Partner sites become a platform-wide shared asset.
-- One record per domain, shared by all brokers. userId tracks who added it (attribution only).
-- Discovery runs once and benefits the whole platform — a network effect that improves over time.

-- Step 1: For each domain that appears more than once (across different users),
-- keep the record with the most complete profile (has propertyUrlPatterns), deleting the rest.
-- In practice there are very few duplicates at this stage so this is safe.
DELETE FROM "partner_sites" ps
WHERE id NOT IN (
  SELECT DISTINCT ON (domain) id
  FROM "partner_sites"
  ORDER BY domain,
           array_length("property_url_patterns", 1) DESC NULLS LAST,
           "last_discovered_at" DESC NULLS LAST,
           "created_at" ASC
);

-- Step 2: Make user_id nullable (attribution only, no longer required)
ALTER TABLE "partner_sites" ALTER COLUMN "user_id" DROP NOT NULL;

-- Step 3: Drop old composite unique constraint and index
DROP INDEX IF EXISTS "partner_sites_user_id_domain_key";
DROP INDEX IF EXISTS "partner_sites_user_id_active_idx";

-- Step 4: Add new global unique constraint on domain alone
ALTER TABLE "partner_sites" ADD CONSTRAINT "partner_sites_domain_key" UNIQUE ("domain");

-- Step 5: Add new index for active lookups
CREATE INDEX "partner_sites_active_idx" ON "partner_sites" ("active");
