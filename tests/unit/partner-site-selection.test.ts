import { describe, it, expect } from 'vitest';
import {
  isLiveSite,
  selectionAnalysis,
  toggleSelectionIds,
  toggleSelectAllIds,
} from '@/lib/partner-site-selection';
import type { PartnerSiteForSelection } from '@/lib/partner-site-selection';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSite(overrides: Partial<PartnerSiteForSelection>): PartnerSiteForSelection {
  return {
    id: 'site-1',
    listingCount: 0,
    propertyUrlPatterns: [],
    listingUrlPatterns: [],
    discoveryStrategy: '',
    consecutiveFailures: 0,
    ...overrides,
  };
}

const indexed = makeSite({ id: 'indexed', listingCount: 120 });
const live = makeSite({ id: 'live', listingCount: 0, propertyUrlPatterns: ['/imovel/*'] });
const liveByStrategy = makeSite({ id: 'live-strategy', listingCount: 0, discoveryStrategy: 'sitemap' });
const liveByListing = makeSite({ id: 'live-listing', listingCount: 0, listingUrlPatterns: ['/lista/*'] });
const noProfile = makeSite({ id: 'noprofile', listingCount: 0 });

const allSites = [indexed, live, liveByStrategy, liveByListing, noProfile];

// ---------------------------------------------------------------------------
// isLiveSite
// ---------------------------------------------------------------------------

describe('isLiveSite', () => {
  it('retorna false para site indexado (listingCount > 0)', () => {
    expect(isLiveSite(indexed)).toBe(false);
  });

  it('retorna true para site com propertyUrlPatterns e sem estoque', () => {
    expect(isLiveSite(live)).toBe(true);
  });

  it('retorna true para site com discoveryStrategy e sem estoque', () => {
    expect(isLiveSite(liveByStrategy)).toBe(true);
  });

  it('retorna true para site com listingUrlPatterns e sem estoque', () => {
    expect(isLiveSite(liveByListing)).toBe(true);
  });

  it('retorna false para site sem perfil nenhum (sem sync)', () => {
    expect(isLiveSite(noProfile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectionAnalysis
// ---------------------------------------------------------------------------

describe('selectionAnalysis', () => {
  it('conta corretamente indexados, ao vivo e sem sync', () => {
    const result = selectionAnalysis(allSites, ['indexed', 'live', 'noprofile']);
    expect(result.indexedCount).toBe(1);
    expect(result.liveCount).toBe(1);
    expect(result.noProfileCount).toBe(1);
  });

  it('estimatedTime é ~5s quando todos indexados', () => {
    const result = selectionAnalysis(allSites, ['indexed']);
    expect(result.estimatedTime).toBe('~5s');
  });

  it('estimatedTime é ~30–60s quando há ao menos 1 ao vivo', () => {
    const result = selectionAnalysis(allSites, ['indexed', 'live']);
    expect(result.estimatedTime).toBe('~30–60s');
  });

  it('estimatedTime é ~30–60s quando há site sem sync', () => {
    const result = selectionAnalysis(allSites, ['noprofile']);
    expect(result.estimatedTime).toBe('~30–60s');
  });

  it('retorna zeros quando selectedIds está vazio', () => {
    const result = selectionAnalysis(allSites, []);
    expect(result.indexedCount).toBe(0);
    expect(result.liveCount).toBe(0);
    expect(result.noProfileCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toggleSelectionIds
// ---------------------------------------------------------------------------

describe('toggleSelectionIds', () => {
  it('adiciona site quando não está selecionado', () => {
    const result = toggleSelectionIds('indexed', allSites, []);
    expect(result).toContain('indexed');
  });

  it('remove site quando já está selecionado (deselect)', () => {
    const result = toggleSelectionIds('indexed', allSites, ['indexed', 'live']);
    expect(result).not.toContain('indexed');
    expect(result).toContain('live');
  });

  it('bloqueia adição quando maxSelectable atingido', () => {
    const selected = ['indexed', 'live'];
    const result = toggleSelectionIds('noprofile', allSites, selected, 2);
    expect(result).toEqual(selected); // não mudou
  });

  it('permite adicionar quando abaixo do maxSelectable', () => {
    const result = toggleSelectionIds('indexed', allSites, ['live'], 3);
    expect(result).toContain('indexed');
    expect(result).toContain('live');
    expect(result).toHaveLength(2);
  });

  it('bloqueia segundo site ao vivo', () => {
    const selected = ['live'];
    const result = toggleSelectionIds('live-strategy', allSites, selected, 5);
    expect(result).toEqual(selected); // não acrescentou
  });

  it('bloqueia segundo site ao vivo mesmo sem limite de quantidade', () => {
    const result = toggleSelectionIds('live-listing', allSites, ['live']);
    expect(result).toEqual(['live']);
  });

  it('permite adicionar site indexado mesmo que já haja 1 ao vivo', () => {
    const result = toggleSelectionIds('indexed', allSites, ['live'], 5);
    expect(result).toContain('indexed');
    expect(result).toContain('live');
  });

  it('permite adicionar o PRIMEIRO site ao vivo', () => {
    const result = toggleSelectionIds('live', allSites, ['indexed'], 5);
    expect(result).toContain('live');
    expect(result).toContain('indexed');
  });
});

// ---------------------------------------------------------------------------
// toggleSelectAllIds
// ---------------------------------------------------------------------------

describe('toggleSelectAllIds', () => {
  const visibleIds = ['indexed', 'live', 'noprofile'];

  it('seleciona todos os visíveis quando nenhum está marcado', () => {
    const result = toggleSelectAllIds(visibleIds, []);
    expect(result).toEqual(expect.arrayContaining(visibleIds));
    expect(result).toHaveLength(visibleIds.length);
  });

  it('desmarca tudo quando todos já estão selecionados', () => {
    const result = toggleSelectAllIds(visibleIds, visibleIds);
    expect(result).toEqual([]);
  });

  it('respeita maxSelectable ao selecionar todos', () => {
    const result = toggleSelectAllIds(visibleIds, [], 2);
    expect(result).toHaveLength(2);
  });

  it('não adiciona além do limite quando alguns já estão selecionados', () => {
    // 1 já selecionado, limite 2 → deve adicionar no máximo 1
    const result = toggleSelectAllIds(visibleIds, ['indexed'], 2);
    expect(result).toHaveLength(2);
    expect(result).toContain('indexed');
  });

  it('quando limite <= já selecionados, não adiciona nenhum', () => {
    const result = toggleSelectAllIds(['live', 'noprofile'], ['indexed', 'live-strategy'], 2);
    expect(result).toHaveLength(2);
    // os já selecionados se mantêm, nada novo
    expect(result).toContain('indexed');
    expect(result).toContain('live-strategy');
  });
});
