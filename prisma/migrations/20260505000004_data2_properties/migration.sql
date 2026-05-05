-- DATA-2 (Sprint 3): properties + property_sources
-- Ticket: DATA-2 | Depends on: DATA-1
--
-- properties  = canonical deduplicated record (one per real-world property)
-- property_sources = raw listing per source (many per property)
--
-- Dedup key: address_normalized + geohash7 + bedrooms
-- Amenity extraction happens at ingestion time (LLM → extractedAmenities JSONB)

CREATE TYPE "PropertySource" AS ENUM ('zap', 'vivareal', 'mock');
CREATE TYPE "PropertyType" AS ENUM (
  'apartment', 'house', 'studio', 'penthouse',
  'commercial', 'warehouse', 'land', 'other'
);

CREATE TABLE properties (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address_normalized  TEXT NOT NULL,
  geohash7            VARCHAR(7),
  neighborhood        TEXT,
  city                TEXT NOT NULL,
  state               VARCHAR(2) NOT NULL,
  property_type       "PropertyType" NOT NULL,
  bedrooms            INTEGER,
  bathrooms           INTEGER,
  area_sqm            NUMERIC(8, 2),
  parking_spots       INTEGER,
  price               NUMERIC(14, 2) NOT NULL,
  price_type          VARCHAR(4) NOT NULL CHECK (price_type IN ('sale', 'rent')),
  furnished           BOOLEAN,
  amenities           JSONB,            -- structured from source fields
  extracted_amenities JSONB,            -- LLM-extracted from description
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active              BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_properties_geohash7         ON properties (geohash7);
CREATE INDEX idx_properties_city_neighborhood ON properties (city, neighborhood);
CREATE INDEX idx_properties_price            ON properties (price);
CREATE INDEX idx_properties_bedrooms         ON properties (bedrooms);
CREATE INDEX idx_properties_active_last_seen ON properties (active, last_seen_at DESC);

-- GIN index for amenity/extracted_amenities JSONB queries
CREATE INDEX idx_properties_amenities          ON properties USING GIN (amenities);
CREATE INDEX idx_properties_extracted_amenities ON properties USING GIN (extracted_amenities);

CREATE TABLE property_sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  source       "PropertySource" NOT NULL,
  external_id  TEXT,
  url          TEXT NOT NULL,
  title        TEXT,
  description  TEXT,
  photos       JSONB,           -- TEXT[] of photo URLs
  raw_price    NUMERIC(14, 2) NOT NULL,
  raw_data     JSONB,           -- full raw scrape payload
  scraped_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_property_sources_source_external UNIQUE (source, external_id)
);

CREATE INDEX idx_property_sources_property_id ON property_sources (property_id);
CREATE INDEX idx_property_sources_scraped_at  ON property_sources (source, scraped_at DESC);

-- RLS: brokers can read all properties (public listing data — no PII)
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "properties_read_all" ON properties
  FOR SELECT USING (TRUE);

CREATE POLICY "property_sources_read_all" ON property_sources
  FOR SELECT USING (TRUE);

-- Only service role (BYPASSRLS) can insert/update/delete
-- Application inserts via background job with service-role client
