import 'server-only';
import type { NormalizedListing, SearchCriteria } from './types';

/**
 * Fit score — 0 to 100 (with up to +15 description-match bonus, capped at 100).
 *
 * Scoring is dynamic: only criteria that were explicitly provided contribute
 * to the maximum possible score. A criterion not informed by the broker is
 * simply excluded from the calculation — it never inflates the score.
 *
 * Active criteria and their base weights:
 *   city         20  — always active (required field)
 *   neighborhood 25  — active when neighborhood/neighborhoods specified
 *   bedrooms     20  — active when bedroomsMin specified; above bedroomsMax = hard fail
 *   price        15  — active ONLY when priceMin or priceMax specified
 *   area          8  — active when areaMin specified
 *   parking       2  — active when parkingMin specified
 *   furnished     2  — active when furnished specified
 *   propertyType  6  — active when propertyType specified
 *   amenities     8  — active when amenities list specified
 *
 * Final base score = (earned / possible) * 100
 * Description bonus (up to +15) applied on top, capped at 100.
 */

interface ScoredListing {
  listing: NormalizedListing;
  score: number;
  scoreBreakdown: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Weights — used proportionally; sum is irrelevant since we normalize.
// ---------------------------------------------------------------------------

const W = {
  city: 20,
  neighborhood: 25,
  bedrooms: 20,
  price: 15,
  area: 8,
  parking: 2,
  furnished: 2,
  propertyType: 6,
  amenities: 8,
};

const DESCRIPTION_BONUS_MAX = 15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function textContains(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return norm(haystack).includes(norm(needle));
}

function neighborhoodMatches(listing: NormalizedListing, criteria: SearchCriteria): boolean {
  if (!listing.neighborhood) return false;

  const haystack = norm(listing.neighborhood);
  const candidates = [
    ...(criteria.neighborhoods ?? []),
    ...(criteria.neighborhood ? [criteria.neighborhood] : []),
  ];

  return candidates.some((n) => {
    const needle = norm(n);
    return haystack.includes(needle) || needle.includes(haystack);
  });
}

/**
 * Groups property type strings into equivalence classes so that
 * "Apartamento", "apartment", "flat", "cobertura" all match each other,
 * while "casa", "house", "sobrado" form a separate group.
 */
function propertyTypeMatches(listingType: string, criteriaType: string): boolean {
  const n = (t: string) =>
    t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');

  const lt = n(listingType);
  const ct = n(criteriaType);

  if (lt === ct || lt.includes(ct) || ct.includes(lt)) return true;

  const GROUPS: string[][] = [
    ['apartment', 'apartamento', 'flat', 'studio', 'kitnet', 'kitinete', 'cobertura', 'penthouse', 'loft', 'studios'],
    ['house', 'casa', 'sobrado', 'bangalo', 'chacara', 'sitio', 'fazenda', 'vila', 'condominio'],
    ['commercial', 'comercial', 'loja', 'sala', 'escritorio', 'galpao', 'deposito', 'warehouse'],
    ['land', 'terreno', 'lote'],
  ];

  for (const group of GROUPS) {
    const ctInGroup = group.some((a) => ct.includes(a) || a.includes(ct));
    const ltInGroup = group.some((a) => lt.includes(a) || a.includes(lt));
    if (ctInGroup) return ltInGroup; // if criteria is in a group, listing must be too
  }

  return true; // unknown type — don't penalize
}

// ---------------------------------------------------------------------------
// Core scoring
// ---------------------------------------------------------------------------

export function fitScore(listing: NormalizedListing, criteria: SearchCriteria): ScoredListing {
  const breakdown: Record<string, number> = {};
  let earned = 0;
  let possible = 0;

  // 1. City — always active; wrong city = 0 for everything
  possible += W.city;
  const cityOk =
    textContains(listing.city, criteria.city) ||
    textContains(criteria.city, listing.city);
  breakdown.city = cityOk ? W.city : 0;
  earned += breakdown.city;

  // 2. Neighborhood — active only when specified
  const hasNeighborhoodCriteria =
    (criteria.neighborhoods?.length ?? 0) > 0 || !!criteria.neighborhood;

  if (hasNeighborhoodCriteria) {
    possible += W.neighborhood;
    if (!listing.neighborhood) {
      breakdown.neighborhood = Math.round(W.neighborhood * 0.5); // missing data — partial
    } else if (neighborhoodMatches(listing, criteria)) {
      breakdown.neighborhood = W.neighborhood;
    } else {
      breakdown.neighborhood = 0;
    }
    earned += breakdown.neighborhood;
  }

  // 3. Bedrooms — active when bedroomsMin specified
  //    Above bedroomsMax is now a hard fail (0), same as below bedroomsMin.
  if (criteria.bedroomsMin != null && listing.bedrooms != null) {
    possible += W.bedrooms;
    if (listing.bedrooms < criteria.bedroomsMin) {
      breakdown.bedrooms = 0; // hard fail — below minimum
    } else if (criteria.bedroomsMax != null && listing.bedrooms > criteria.bedroomsMax) {
      breakdown.bedrooms = 0; // hard fail — above maximum
    } else {
      breakdown.bedrooms = W.bedrooms;
    }
    earned += breakdown.bedrooms;
  }

  // 4. Price — active ONLY when priceMax or priceMin was explicitly provided.
  //    Exact range: anything above priceMax or below priceMin is a hard fail.
  if ((criteria.priceMax != null || criteria.priceMin != null) && listing.price > 0) {
    if (criteria.priceMax != null && listing.price > criteria.priceMax) {
      return { listing, score: 0, scoreBreakdown: { priceHardFail: 0 } };
    }
    if (criteria.priceMin != null && listing.price < criteria.priceMin) {
      return { listing, score: 0, scoreBreakdown: { priceHardFail: 0 } };
    }
    possible += W.price;
    breakdown.price = W.price;
    earned += breakdown.price;
  }

  // 5. Area — active when areaMin or areaMax specified.
  //    Exact range: anything below areaMin or above areaMax is a hard fail.
  if ((criteria.areaMin != null || criteria.areaMax != null) && listing.areaSqm != null) {
    if (criteria.areaMin != null && listing.areaSqm < criteria.areaMin) {
      return { listing, score: 0, scoreBreakdown: { areaHardFail: 0 } };
    }
    if (criteria.areaMax != null && listing.areaSqm > criteria.areaMax) {
      return { listing, score: 0, scoreBreakdown: { areaHardFail: 0 } };
    }
    possible += W.area;
    breakdown.area = W.area;
    earned += breakdown.area;
  }

  // 6. Parking — active when parkingMin specified
  if (criteria.parkingMin != null && listing.parkingSpots != null) {
    possible += W.parking;
    breakdown.parking = listing.parkingSpots >= criteria.parkingMin ? W.parking : 0;
    earned += breakdown.parking;
  }

  // 7. Furnished — active when specified
  if (criteria.furnished != null && listing.furnished != null) {
    possible += W.furnished;
    breakdown.furnished = criteria.furnished === listing.furnished ? W.furnished : 0;
    earned += breakdown.furnished;
  }

  // 8. Property type — active when specified
  if (criteria.propertyType && listing.propertyType) {
    possible += W.propertyType;
    breakdown.propertyType = propertyTypeMatches(listing.propertyType, criteria.propertyType)
      ? W.propertyType
      : 0;
    earned += breakdown.propertyType;
  }

  // 9. Structured amenities — active when list specified
  if (criteria.amenities && criteria.amenities.length > 0) {
    possible += W.amenities;
    const matched = criteria.amenities.filter((wanted) => {
      const wantedNorm = norm(wanted);
      const inRaw = listing.amenities.some((a) => norm(a).includes(wantedNorm));
      const inExtracted = Object.entries(listing.extractedAmenities).some(
        ([k, v]) => v && norm(k).includes(wantedNorm.replace(/\s+/g, '')),
      );
      return inRaw || inExtracted;
    });
    breakdown.amenities = Math.round(W.amenities * (matched.length / criteria.amenities.length));
    earned += breakdown.amenities;
  }

  // Pet-friendly hard requirement — subtract 10 pts if required but not present
  if (criteria.petFriendly === true && !listing.extractedAmenities.petFriendly) {
    earned = Math.max(0, earned - 10);
    breakdown.petFriendlyPenalty = -10;
  }

  // Normalize to 0–100 based on active criteria only
  const baseScore = possible > 0 ? Math.round((earned / possible) * 100) : 0;

  // ---------------------------------------------------------------------------
  // 10. Description match bonus (up to +15)
  //
  // Searches title + description for amenity/note terms from the briefing.
  // Applied on top of the normalized base score, capped at 100.
  // ---------------------------------------------------------------------------

  const descriptionSearchTerms: string[] = [
    ...(criteria.amenities ?? []),
    ...(criteria.notes
      ? criteria.notes.split(/[\s,;.]+/).filter((t) => t.length > 4)
      : []),
  ].filter(Boolean);

  let descBonus = 0;
  if (descriptionSearchTerms.length > 0) {
    const searchText = `${listing.title} ${listing.description}`;
    const descMatched = descriptionSearchTerms.filter((term) =>
      textContains(searchText, term),
    );
    descBonus = Math.round(
      DESCRIPTION_BONUS_MAX * (descMatched.length / descriptionSearchTerms.length),
    );
  }
  breakdown.descriptionBonus = descBonus;

  return {
    listing,
    score: Math.min(100, Math.max(0, baseScore + descBonus)),
    scoreBreakdown: breakdown,
  };
}

/**
 * Score, sort and return all listings.
 *
 * Sort order:
 *   1. Score descending
 *   2. Neighborhood match first (tiebreaker for equal scores)
 *   3. ZAP source first
 *   4. Most recent scrapedAt
 *   5. Lowest price
 */
export function scoreAndSort(
  listings: NormalizedListing[],
  criteria: SearchCriteria,
): ScoredListing[] {
  const scored = listings.map((l) => fitScore(l, criteria));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    // Tiebreaker: neighborhood match first
    const aNbMatch = neighborhoodMatches(a.listing, criteria) ? 0 : 1;
    const bNbMatch = neighborhoodMatches(b.listing, criteria) ? 0 : 1;
    if (aNbMatch !== bNbMatch) return aNbMatch - bNbMatch;

    // Tiebreaker: ZAP first
    const aZap = a.listing.source === 'zap' ? 0 : 1;
    const bZap = b.listing.source === 'zap' ? 0 : 1;
    if (aZap !== bZap) return aZap - bZap;

    // Tiebreaker: most recent
    const aDate = new Date(a.listing.scrapedAt).getTime();
    const bDate = new Date(b.listing.scrapedAt).getTime();
    if (aDate !== bDate) return bDate - aDate;

    return a.listing.price - b.listing.price;
  });

  return scored;
}
