// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchCriteria } from '@/server/search/types';

// Mock heavy dependencies
vi.mock('@/server/db/client', () => ({
  prisma: {
    property: { upsert: vi.fn().mockResolvedValue({ id: 'prop-1' }) },
    propertySource_: { upsert: vi.fn().mockResolvedValue({}) },
    briefing: { update: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock('@/server/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/server/search/health-monitor', () => ({
  startHealthMonitor: vi.fn(),
}));

// Force mock adapter
process.env.SOURCE_MOCK = 'true';

import { runSearch } from '@/server/search/run-search';

const criteria: SearchCriteria = {
  city: 'São Paulo',
  neighborhood: 'Vila Mariana',
  propertyType: 'apartment',
  bedroomsMin: 2,
  priceMax: 850000,
  purpose: 'buy',
};

describe('runSearch (mock adapter)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna listings do mock adapter', async () => {
    const result = await runSearch(criteria);
    expect(result.listings.length).toBeGreaterThan(0);
    expect(result.sourceErrors).toHaveLength(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('cada listing tem os campos obrigatórios', async () => {
    const { listings } = await runSearch(criteria);
    for (const l of listings) {
      expect(l.source).toBe('mock');
      expect(l.price).toBeGreaterThan(0);
      expect(typeof l.url).toBe('string');
      expect(typeof l.extractedAmenities).toBe('object');
    }
  });

  it('respeita critério de propósito (buy → priceType sale)', async () => {
    const { listings } = await runSearch(criteria);
    expect(listings.every((l) => l.priceType === 'sale')).toBe(true);
  });

  it('retorna priceType rent quando purpose=rent', async () => {
    const { listings } = await runSearch({ ...criteria, purpose: 'rent' });
    expect(listings.every((l) => l.priceType === 'rent')).toBe(true);
  });
});
