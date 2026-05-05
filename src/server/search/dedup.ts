import 'server-only';
import type { NormalizedListing } from './types';
import { normalizeAddress, dedupKey } from './normalize-address';

/**
 * SRC-9: Deduplication algorithm.
 *
 * Dedup key: normalizeAddress(address) + geohash7 + bedrooms
 *
 * When two listings share the same key:
 *   - ZAP is preferred over VivaReal (source priority)
 *   - Among same source: most recent wins (scrapedAt)
 *   - Merge photos: union of both sets (up to 10)
 *
 * p95 budget: 50ms for up to 200 listings (in-memory, no I/O).
 */
export function deduplicate(listings: NormalizedListing[]): NormalizedListing[] {
  const SOURCE_PRIORITY: Record<string, number> = { zap: 0, vivareal: 1, mock: 2 };

  const canonical = new Map<string, NormalizedListing>();

  for (const listing of listings) {
    const addressNorm = normalizeAddress(listing.address);
    const key = dedupKey(addressNorm, listing.geohash7, listing.bedrooms);

    const existing = canonical.get(key);
    if (!existing) {
      canonical.set(key, { ...listing, address: addressNorm });
      continue;
    }

    const existingPriority = SOURCE_PRIORITY[existing.source] ?? 99;
    const newPriority = SOURCE_PRIORITY[listing.source] ?? 99;

    const preferNew =
      newPriority < existingPriority ||
      (newPriority === existingPriority &&
        new Date(listing.scrapedAt) > new Date(existing.scrapedAt));

    if (preferNew) {
      // Keep new listing as canonical, merge photos from both
      const mergedPhotos = Array.from(
        new Set([...listing.photos, ...existing.photos]),
      ).slice(0, 10);

      canonical.set(key, {
        ...listing,
        address: addressNorm,
        photos: mergedPhotos,
        // Keep the most permissive extractedAmenities (OR merge)
        extractedAmenities: mergeAmenities(listing.extractedAmenities, existing.extractedAmenities),
      });
    } else {
      // Keep existing as canonical, but merge photos and amenities
      const mergedPhotos = Array.from(
        new Set([...existing.photos, ...listing.photos]),
      ).slice(0, 10);
      canonical.set(key, {
        ...existing,
        photos: mergedPhotos,
        extractedAmenities: mergeAmenities(existing.extractedAmenities, listing.extractedAmenities),
      });
    }
  }

  return Array.from(canonical.values());
}

function mergeAmenities(
  a: Record<string, boolean>,
  b: Record<string, boolean>,
): Record<string, boolean> {
  const result: Record<string, boolean> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    // If either source says true, we say true (OR merge)
    result[k] = (result[k] ?? false) || v;
  }
  return result;
}
