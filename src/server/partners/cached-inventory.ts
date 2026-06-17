import 'server-only';
import { prisma } from '@/server/db/client';
import type { PartnerSite } from '@prisma/client';
import type { NormalizedListing, SearchCriteria } from '@/server/search/types';

export async function searchCachedInventory(
  site: PartnerSite,
  criteria: SearchCriteria,
): Promise<NormalizedListing[]> {
  const neighborhoodCandidates = [
    ...(criteria.neighborhoods ?? []),
    ...(criteria.neighborhood ? [criteria.neighborhood] : []),
  ].flatMap((n) => {
    const stripped = n.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return stripped !== n ? [n, stripped] : [n];
  });

  const neighborhoodKeywords = [...new Set(
    neighborhoodCandidates.flatMap((n) => n.split(/\s+/).filter((t) => t.length >= 4)),
  )];

  const neighborhoodFilter = neighborhoodKeywords.length > 0
    ? {
        OR: neighborhoodKeywords.map((kw) => ({
          neighborhood: { contains: kw, mode: 'insensitive' as const },
        })),
      }
    : {};

  const hasNeighborhoodFilter = neighborhoodKeywords.length > 0;

  const properties = await prisma.property.findMany({
    where: {
      active: true,
      sources: { some: { partnerSiteId: site.id } },
      priceType: criteria.purpose === 'rent' ? 'rent' : 'sale',
      ...(criteria.priceMax ? { price: { lte: criteria.priceMax * 1.5 } } : {}),
      ...(criteria.bedroomsMin && criteria.bedroomsMin > 1
        ? { bedrooms: { gte: criteria.bedroomsMin - 1 } }
        : {}),
      ...neighborhoodFilter,
    },
    include: {
      sources: {
        where: { partnerSiteId: site.id },
        orderBy: { scrapedAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { lastSeenAt: 'desc' },
    take: hasNeighborhoodFilter ? 300 : 100,
  });

  return properties
    .filter((p) => p.sources.length > 0)
    .map((p) => {
      const src = p.sources[0]!;
      return {
        source: 'portal_x' as const,
        externalId: src.externalId ?? src.url,
        url: src.url,
        title: src.title ?? '',
        description: src.description ?? '',
        photos: Array.isArray(src.photos) ? (src.photos as string[]) : [],
        address: p.addressNormalized,
        neighborhood: p.neighborhood ?? '',
        city: p.city,
        state: p.state,
        propertyType: p.propertyType,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        areaSqm: p.areaSqm !== null ? Number(p.areaSqm) : null,
        parkingSpots: p.parkingSpots,
        price: Number(p.price),
        priceType: p.priceType as 'sale' | 'rent',
        furnished: p.furnished,
        amenities: [],
        extractedAmenities:
          (p.extractedAmenities as Record<string, boolean> | null) ?? {},
        geohash7: p.geohash7,
        lat: null,
        lng: null,
        scrapedAt: src.scrapedAt.toISOString(),
      };
    });
}
