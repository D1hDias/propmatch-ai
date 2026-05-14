import 'server-only';
import type { ExtractedCriteria } from './extract';
import type { SearchCriteria } from '@/server/search/types';

/**
 * Transforms the LLM-extracted criteria (snake_case, plural fields) into the
 * canonical SearchCriteria shape (camelCase, singular neighborhood) used by
 * the search pipeline and scoring engine.
 *
 * This is the single source-of-truth mapping between the two schemas.
 * Without this transformation, all criteria fields appear as undefined in the
 * worker and every property gets a perfect score regardless of fit.
 */
export function toSearchCriteria(ec: ExtractedCriteria): SearchCriteria {
  const neighborhoods = (ec.neighborhoods ?? []).filter(Boolean);

  return {
    city: ec.city ?? 'São Paulo',
    neighborhood: neighborhoods[0] ?? null,
    neighborhoods,
    propertyType: ec.property_type ?? null,
    bedroomsMin: ec.bedrooms_min ?? null,
    bedroomsMax: ec.bedrooms_max ?? null,
    bathroomsMin: ec.bathrooms_min ?? null,
    priceMin: ec.price_min ?? null,
    priceMax: ec.price_max ?? null,
    areaMin: ec.area_min_m2 ?? null,
    areaMax: ec.area_max_m2 ?? null,
    parkingMin: ec.parking_spots ?? null,
    furnished: ec.furnished ?? null,
    petFriendly: ec.pet_friendly ?? null,
    amenities: ec.amenities ?? [],
    notes: ec.notes ?? undefined,
    purpose: ec.purpose ?? 'buy',
  };
}
