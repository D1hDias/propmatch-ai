import 'server-only';
import type { NormalizedListing, SearchCriteria } from './types';

/**
 * SRC-10: Fit score — 0 to 100.
 *
 * Weights are calibrated so:
 *   - A perfect match on all hard criteria scores 100
 *   - Missing a critical field (city, bedrooms, price) causes a steep penalty
 *   - Soft criteria (amenities, furnished) add bonus points up to their cap
 *
 * Tiebreaker order (applied at sort time, not here):
 *   1. ZAP source first
 *   2. More recent scrapedAt
 *   3. Lower price
 */

interface ScoredListing {
  listing: NormalizedListing;
  score: number;
  scoreBreakdown: Record<string, number>;
}

const WEIGHTS = {
  city: 20,         // hard — wrong city = reject
  neighborhood: 15, // important but not always available
  bedrooms: 20,     // hard
  price: 20,        // hard
  area: 10,
  parking: 5,
  furnished: 5,
  amenities: 5,     // structured amenities from source
};

export function fitScore(listing: NormalizedListing, criteria: SearchCriteria): ScoredListing {
  const breakdown: Record<string, number> = {};
  let total = 0;

  // City (hard) — wrong city = 0 points but no outright rejection
  // (let the caller filter by city before scoring)
  const cityMatch =
    listing.city.toLowerCase().includes(criteria.city.toLowerCase()) ||
    criteria.city.toLowerCase().includes(listing.city.toLowerCase());
  breakdown.city = cityMatch ? WEIGHTS.city : 0;
  total += breakdown.city;

  // Neighborhood (soft — portals don't always return it)
  if (criteria.neighborhood && listing.neighborhood) {
    const needle = criteria.neighborhood.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const haystack = listing.neighborhood.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    breakdown.neighborhood = haystack.includes(needle) || needle.includes(haystack)
      ? WEIGHTS.neighborhood
      : 0;
  } else {
    // If criteria has no neighborhood, or listing has no neighborhood, don't penalize
    breakdown.neighborhood = WEIGHTS.neighborhood;
  }
  total += breakdown.neighborhood;

  // Bedrooms
  if (criteria.bedroomsMin != null && listing.bedrooms != null) {
    if (listing.bedrooms < criteria.bedroomsMin) {
      breakdown.bedrooms = 0;
    } else if (criteria.bedroomsMax != null && listing.bedrooms > criteria.bedroomsMax) {
      breakdown.bedrooms = Math.round(WEIGHTS.bedrooms * 0.5); // partial — over the max
    } else {
      breakdown.bedrooms = WEIGHTS.bedrooms;
    }
  } else {
    breakdown.bedrooms = WEIGHTS.bedrooms; // no constraint = no penalty
  }
  total += breakdown.bedrooms;

  // Price
  if (criteria.priceMax != null && listing.price > 0) {
    if (listing.price > criteria.priceMax) {
      // Over budget — penalize proportionally
      const overBy = (listing.price - criteria.priceMax) / criteria.priceMax;
      breakdown.price = overBy > 0.2 ? 0 : Math.round(WEIGHTS.price * (1 - overBy / 0.2));
    } else if (criteria.priceMin != null && listing.price < criteria.priceMin) {
      breakdown.price = Math.round(WEIGHTS.price * 0.7); // under min — likely different product
    } else {
      breakdown.price = WEIGHTS.price;
    }
  } else {
    breakdown.price = WEIGHTS.price;
  }
  total += breakdown.price;

  // Area
  if (criteria.areaMin != null && listing.areaSqm != null) {
    breakdown.area =
      listing.areaSqm >= criteria.areaMin
        ? WEIGHTS.area
        : Math.round(WEIGHTS.area * (listing.areaSqm / criteria.areaMin));
  } else {
    breakdown.area = WEIGHTS.area;
  }
  total += breakdown.area;

  // Parking
  if (criteria.parkingMin != null && listing.parkingSpots != null) {
    breakdown.parking =
      listing.parkingSpots >= criteria.parkingMin ? WEIGHTS.parking : 0;
  } else {
    breakdown.parking = WEIGHTS.parking;
  }
  total += breakdown.parking;

  // Furnished
  if (criteria.furnished != null && listing.furnished != null) {
    breakdown.furnished = criteria.furnished === listing.furnished ? WEIGHTS.furnished : 0;
  } else {
    breakdown.furnished = WEIGHTS.furnished;
  }
  total += breakdown.furnished;

  // Amenities — check extractedAmenities (from description) and raw amenities list
  if (criteria.amenities && criteria.amenities.length > 0) {
    const matched = criteria.amenities.filter((wanted) => {
      const wantedLower = wanted.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      // Check raw amenities list
      const inRaw = listing.amenities.some((a) =>
        a.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(wantedLower),
      );
      // Check extracted amenities (camelCase keys)
      const inExtracted = Object.entries(listing.extractedAmenities).some(
        ([k, v]) => v && k.toLowerCase().includes(wantedLower.replace(/\s/g, '')),
      );
      return inRaw || inExtracted;
    });
    breakdown.amenities = Math.round(
      WEIGHTS.amenities * (matched.length / criteria.amenities.length),
    );
  } else {
    breakdown.amenities = WEIGHTS.amenities;
  }
  total += breakdown.amenities;

  // Pet-friendly bonus (uses extractedAmenities)
  if (criteria.petFriendly === true) {
    if (!listing.extractedAmenities.petFriendly) {
      total = Math.max(0, total - 10); // strong penalty for must-have not met
    }
  }

  return { listing, score: Math.min(100, Math.max(0, total)), scoreBreakdown: breakdown };
}

/**
 * Score and sort a list of listings, applying tiebreaker order:
 * 1. ZAP source first
 * 2. Most recent (scrapedAt)
 * 3. Lowest price
 */
export function scoreAndSort(
  listings: NormalizedListing[],
  criteria: SearchCriteria,
): ScoredListing[] {
  const scored = listings.map((l) => fitScore(l, criteria));

  scored.sort((a, b) => {
    // Primary: score descending
    if (b.score !== a.score) return b.score - a.score;

    // Tiebreaker 1: ZAP first
    const aIsZap = a.listing.source === 'zap' ? 0 : 1;
    const bIsZap = b.listing.source === 'zap' ? 0 : 1;
    if (aIsZap !== bIsZap) return aIsZap - bIsZap;

    // Tiebreaker 2: most recent
    const aDate = new Date(a.listing.scrapedAt).getTime();
    const bDate = new Date(b.listing.scrapedAt).getTime();
    if (aDate !== bDate) return bDate - aDate;

    // Tiebreaker 3: lowest price
    return a.listing.price - b.listing.price;
  });

  return scored;
}
