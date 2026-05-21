import 'server-only';
import type { ExtractedCriteria } from './extract';
import type { SearchCriteria } from '@/server/search/types';

/**
 * Transforms the LLM-extracted criteria (nested: location, hard_filters, soft_preferences)
 * into the canonical SearchCriteria shape used by the search pipeline and scoring engine.
 *
 * Also handles the flat SearchCriteria format stored by the Categories form, which writes
 * camelCase fields (priceMin, areaMin, etc.) directly instead of the nested LLM format.
 */
export function toSearchCriteria(ec: ExtractedCriteria): SearchCriteria {
  // Categories form stores flat SearchCriteria directly (has 'purpose' or 'priceMin' at root).
  // Detect by checking for a field that only exists in SearchCriteria, not ExtractedCriteria.
  if ('purpose' in ec || 'priceMin' in ec || 'bedroomsMin' in ec) {
    return ec as unknown as SearchCriteria;
  }

  const neighborhoods = ec.location?.neighborhoods ?? [];
  const hf = ec.hard_filters ?? {};
  const sp = ec.soft_preferences ?? {};

  return {
    city: ec.location?.city ?? '',
    state: ec.location?.state ?? '',
    neighborhood: neighborhoods[0] ?? null,
    neighborhoods,
    propertyType: hf.property_type ?? null,
    bedroomsMin: hf.bedrooms_min ?? null,
    bedroomsMax: hf.bedrooms_max ?? null,
    bathroomsMin: hf.bathrooms_min ?? null,
    priceMin: hf.price_min ?? null,
    priceMax: hf.price_max ?? null,
    areaMin: hf.area_min_m2 ?? null,
    areaMax: hf.area_max_m2 ?? null,
    parkingMin: hf.parking_min ?? null,
    furnished: sp.furnished ?? null,
    petFriendly: sp.pet_friendly ?? null,
    nearMetro: sp.near_metro ?? null,
    urgency: ec.urgency ?? null,
    amenities: sp.amenities ?? [],
    notes: ec.notes ?? undefined,
    purpose: ec.intent ?? 'buy',
  };
}
