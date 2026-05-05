import { describe, it, expect } from 'vitest';
import { deduplicate } from '@/server/search/dedup';
import { scoreAndSort } from '@/server/search/fit-score';
import type { NormalizedListing, SearchCriteria } from '@/server/search/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeListing(overrides: Partial<NormalizedListing>): NormalizedListing {
  return {
    externalId: 'ext-1',
    source: 'mock',
    url: 'http://example.com/1',
    title: 'Apartamento Teste',
    description: '',
    address: 'Rua das Flores, 100',
    neighborhood: 'Vila Mariana',
    city: 'São Paulo',
    state: 'SP',
    propertyType: 'apartment',
    bedrooms: 2,
    bathrooms: 1,
    areaSqm: 60,
    parkingSpots: 1,
    price: 500000,
    priceType: 'sale',
    furnished: false,
    amenities: [],
    extractedAmenities: {},
    photos: [],
    lat: -23.5,
    lng: -46.6,
    geohash7: 'gg7jf08',
    scrapedAt: new Date('2026-01-01').toISOString(),
    ...overrides,
  };
}

const criteria: SearchCriteria = {
  city: 'São Paulo',
  neighborhood: 'Vila Mariana',
  bedroomsMin: 2,
  priceMax: 600000,
  purpose: 'buy',
};

// ---------------------------------------------------------------------------
// Dedup tests
// ---------------------------------------------------------------------------

describe('deduplicate', () => {
  it('returns single listing unchanged', () => {
    const listings = [makeListing({ externalId: 'a1' })];
    expect(deduplicate(listings)).toHaveLength(1);
  });

  it('deduplicates two listings with same address+geohash+bedrooms', () => {
    const a = makeListing({ externalId: 'a1', source: 'vivareal' });
    const b = makeListing({ externalId: 'b1', source: 'zap' });
    const result = deduplicate([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe('zap'); // ZAP wins
  });

  it('keeps two listings with different bedrooms as separate', () => {
    const a = makeListing({ externalId: 'a1', bedrooms: 2 });
    const b = makeListing({ externalId: 'b1', bedrooms: 3 });
    expect(deduplicate([a, b])).toHaveLength(2);
  });

  it('keeps two listings with different geohash as separate', () => {
    const a = makeListing({ externalId: 'a1', geohash7: 'gg7jf08' });
    const b = makeListing({ externalId: 'b1', geohash7: 'gg7jf09' });
    expect(deduplicate([a, b])).toHaveLength(2);
  });

  it('merges photos (union, max 10)', () => {
    const a = makeListing({ externalId: 'a1', source: 'zap', photos: ['p1', 'p2'] });
    const b = makeListing({ externalId: 'b1', source: 'vivareal', photos: ['p2', 'p3'] });
    const result = deduplicate([a, b]);
    expect(result[0]!.photos).toContain('p1');
    expect(result[0]!.photos).toContain('p3');
    expect(result[0]!.photos).toHaveLength(3); // p1, p2, p3 — no duplicates
  });

  it('prefers most recent when source is same', () => {
    const old = makeListing({ externalId: 'a1', source: 'zap', scrapedAt: '2026-01-01T00:00:00Z', price: 500000 });
    const recent = makeListing({ externalId: 'b1', source: 'zap', scrapedAt: '2026-02-01T00:00:00Z', price: 480000 });
    const result = deduplicate([old, recent]);
    expect(result[0]!.price).toBe(480000);
  });

  it('OR-merges extractedAmenities', () => {
    const a = makeListing({ externalId: 'a1', source: 'vivareal', extractedAmenities: { piscina: false, academia: true } });
    const b = makeListing({ externalId: 'b1', source: 'zap', extractedAmenities: { piscina: true, academia: false } });
    const result = deduplicate([a, b]);
    expect(result[0]!.extractedAmenities.piscina).toBe(true);
    expect(result[0]!.extractedAmenities.academia).toBe(true);
  });

  it('handles 200 listings without exceeding 50ms', () => {
    const listings = Array.from({ length: 200 }, (_, i) =>
      makeListing({
        externalId: `ext-${i}`,
        address: `Rua ${i}, 100`,
        geohash7: `gg7jf${String(i).padStart(2, '0')}`,
      })
    );
    const start = Date.now();
    const result = deduplicate(listings);
    const elapsed = Date.now() - start;
    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// FitScore tests
// ---------------------------------------------------------------------------

describe('scoreAndSort', () => {
  it('returns empty array for empty listings', () => {
    expect(scoreAndSort([], criteria)).toHaveLength(0);
  });

  it('scores perfect match at 100', () => {
    const listing = makeListing({
      city: 'São Paulo',
      neighborhood: 'Vila Mariana',
      bedrooms: 2,
      price: 500000,
      priceType: 'sale',
    });
    const result = scoreAndSort([listing], criteria);
    expect(result[0]!.score).toBe(100);
  });

  it('penalizes wrong city', () => {
    const listing = makeListing({ city: 'Curitiba' });
    const result = scoreAndSort([listing], criteria);
    expect(result[0]!.score).toBeLessThanOrEqual(80);
  });

  it('penalizes price above max', () => {
    const listing = makeListing({ price: 700000 }); // above priceMax: 600000
    const result = scoreAndSort([listing], criteria);
    expect(result[0]!.score).toBeLessThan(100);
  });

  it('sorts by score descending', () => {
    const good = makeListing({ externalId: 'good', city: 'São Paulo', neighborhood: 'Vila Mariana', bedrooms: 2, price: 500000 });
    const bad = makeListing({ externalId: 'bad', city: 'Curitiba', neighborhood: 'Centro', bedrooms: 4, price: 900000 });
    const result = scoreAndSort([bad, good], criteria);
    expect(result[0]!.listing.externalId).toBe('good');
  });

  it('tiebreaker: ZAP before VivaReal', () => {
    const zap = makeListing({ externalId: 'z', source: 'zap', city: 'São Paulo', neighborhood: 'Vila Mariana', bedrooms: 2, price: 500000 });
    const viva = makeListing({ externalId: 'v', source: 'vivareal', city: 'São Paulo', neighborhood: 'Vila Mariana', bedrooms: 2, price: 500000 });
    const result = scoreAndSort([viva, zap], criteria);
    expect(result[0]!.listing.source).toBe('zap');
  });

  it('tiebreaker: most recent before older (same source)', () => {
    const old = makeListing({ externalId: 'old', source: 'zap', scrapedAt: '2026-01-01T00:00:00Z', city: 'São Paulo', neighborhood: 'Vila Mariana', bedrooms: 2, price: 500000 });
    const recent = makeListing({ externalId: 'new', source: 'zap', scrapedAt: '2026-06-01T00:00:00Z', city: 'São Paulo', neighborhood: 'Vila Mariana', bedrooms: 2, price: 500000 });
    const result = scoreAndSort([old, recent], criteria);
    expect(result[0]!.listing.externalId).toBe('new');
  });

  it('scoreBreakdown keys are present', () => {
    const listing = makeListing({});
    const result = scoreAndSort([listing], criteria);
    const breakdown = result[0]!.scoreBreakdown;
    expect(breakdown).toHaveProperty('city');
    expect(breakdown).toHaveProperty('neighborhood');
    expect(breakdown).toHaveProperty('bedrooms');
    expect(breakdown).toHaveProperty('price');
  });
});
