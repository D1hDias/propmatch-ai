import 'server-only';

// ---------------------------------------------------------------------------
// Search criteria — derived from the briefing's extractedCriteria
// ---------------------------------------------------------------------------

export interface SearchCriteria {
  city: string;
  /** State abbreviation inferred from city/neighborhoods (e.g. "SP", "RJ"). */
  state?: string;
  /** Primary neighborhood (used for URL construction). */
  neighborhood?: string | null;
  /** All requested neighborhoods — listing matches if it's in ANY of them. */
  neighborhoods?: string[];
  propertyType?: string | null;
  bedroomsMin?: number | null;
  bedroomsMax?: number | null;
  bathroomsMin?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  areaMin?: number | null;
  areaMax?: number | null;
  parkingMin?: number | null;
  furnished?: boolean | null;
  petFriendly?: boolean | null;
  /** Amenity/detail terms from the briefing (e.g. "sol da manhã", "portaria 24h"). */
  amenities?: string[];
  /** Free-text notes that describe desirable details. Searched in listing descriptions. */
  notes?: string;
  /** Whether proximity to metro/subway was requested. */
  nearMetro?: boolean | null;
  /** Urgency inferred from the briefing text. */
  urgency?: 'low' | 'medium' | 'high' | null;
  purpose: 'buy' | 'rent';
}

// ---------------------------------------------------------------------------
// Normalized listing — common shape after adapter normalization
// ---------------------------------------------------------------------------

export interface NormalizedListing {
  /** Source identifier */
  source: 'zap' | 'vivareal' | 'mock' | 'portal_x' | 'partner_b';
  /** External ID from the source portal */
  externalId: string;
  /** Canonical listing URL */
  url: string;
  title: string;
  description: string;
  /** Photo URLs from the portal (original, not re-hosted) */
  photos: string[];
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  propertyType: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  parkingSpots: number | null;
  price: number;
  /** 'sale' | 'rent' */
  priceType: 'sale' | 'rent';
  furnished: boolean | null;
  /** Structured amenities from source fields (pool, gym, etc.) */
  amenities: string[];
  /**
   * Amenities extracted by LLM from free-text description at ingestion time.
   * Keys are camelCase amenity names; values are boolean.
   * e.g. { portaria24h: true, petFriendly: false, academia: true }
   */
  extractedAmenities: Record<string, boolean>;
  /** Geohash precision-7 (~150m cell). Null when coordinates unavailable. */
  geohash7: string | null;
  lat: number | null;
  lng: number | null;
  /** ISO string timestamp of when this was scraped */
  scrapedAt: string;
  /** Partner site that produced this listing (set when sourced from a PartnerSite adapter). */
  partnerSiteId?: string;
}

// ---------------------------------------------------------------------------
// SourceAdapter interface — every source implements this
// ---------------------------------------------------------------------------

export interface HealthStatus {
  source: string;
  healthy: boolean;
  /** Success rate of the last N requests (0-1) */
  successRate: number;
  lastCheckedAt: string;
  message?: string;
}

export interface SourceAdapter {
  readonly name: 'zap' | 'vivareal' | 'mock' | 'portal_x' | 'partner_b';
  search(criteria: SearchCriteria): Promise<NormalizedListing[]>;
  healthCheck(): Promise<HealthStatus>;
}
