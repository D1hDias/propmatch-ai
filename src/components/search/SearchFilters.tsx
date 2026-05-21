'use client';

import { ArrowDownAZ, ArrowUpAZ, SlidersHorizontal } from 'lucide-react';
import type { PropertyCardData } from './PropertyCard';

export type SortKey = 'score' | 'price_asc' | 'price_desc' | 'area_desc';

export interface FilterState {
  sort: SortKey;
  bedroomsMin: number | null;
  priceMax: number | null;
  neighborhood: string | null;
}

interface SearchFiltersProps {
  listings: PropertyCardData[];
  filters: FilterState;
  onChange: (next: FilterState) => void;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'score', label: 'Melhor match' },
  { value: 'price_asc', label: 'Menor preço' },
  { value: 'price_desc', label: 'Maior preço' },
  { value: 'area_desc', label: 'Maior área' },
];

function normNeighborhood(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function SearchFilters({ listings, filters, onChange }: SearchFiltersProps) {
  // Derive filter options — deduplicate neighborhoods by normalized name (case/accent-insensitive)
  const neighMap = new Map<string, string>();
  for (const l of listings) {
    if (!l.neighborhood) continue;
    const key = normNeighborhood(l.neighborhood);
    if (!neighMap.has(key)) neighMap.set(key, l.neighborhood);
  }
  const neighborhoods = [...neighMap.values()].sort((a, b) =>
    normNeighborhood(a).localeCompare(normNeighborhood(b)),
  );

  const bedroomCounts = Array.from(
    new Set(listings.map((l) => l.bedrooms).filter((b): b is number => b !== null)),
  ).sort((a, b) => a - b);

  function set<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground shrink-0">
        <SlidersHorizontal className="w-4 h-4" />
        Filtrar:
      </span>

      {/* Sort */}
      <div className="flex items-center gap-1.5">
        {filters.sort === 'price_asc' ? (
          <ArrowUpAZ className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ArrowDownAZ className="w-4 h-4 text-muted-foreground" />
        )}
        <select
          value={filters.sort}
          onChange={(e) => set('sort', e.target.value as SortKey)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Bedrooms */}
      {bedroomCounts.length > 1 && (
        <select
          value={filters.bedroomsMin ?? ''}
          onChange={(e) => set('bedroomsMin', e.target.value ? Number(e.target.value) : null)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Quartos: todos</option>
          {bedroomCounts.map((n) => (
            <option key={n} value={n}>
              {n}+ quarto{n !== 1 ? 's' : ''}
            </option>
          ))}
        </select>
      )}

      {/* Neighborhood */}
      {neighborhoods.length > 1 && (
        <select
          value={filters.neighborhood ?? ''}
          onChange={(e) => set('neighborhood', e.target.value || null)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Bairro: todos</option>
          {neighborhoods.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}

      {/* Price max */}
      <select
        value={filters.priceMax ?? ''}
        onChange={(e) => set('priceMax', e.target.value ? Number(e.target.value) : null)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">Preço: todos</option>
        {[500_000, 750_000, 1_000_000, 1_500_000, 2_000_000].map((v) => (
          <option key={v} value={v}>
            até {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)}
          </option>
        ))}
      </select>

      {/* Reset */}
      {(filters.bedroomsMin !== null || filters.priceMax !== null || filters.neighborhood !== null || filters.sort !== 'score') && (
        <button
          onClick={() => onChange({ sort: 'score', bedroomsMin: null, priceMax: null, neighborhood: null })}
          className="h-8 px-3 rounded-md text-xs text-muted-foreground border border-input hover:bg-muted transition-colors"
        >
          Limpar
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure filter + sort function — used by SearchResults
// ---------------------------------------------------------------------------

export function applyFilters(listings: PropertyCardData[], filters: FilterState): PropertyCardData[] {
  let result = listings;

  if (filters.bedroomsMin !== null) {
    result = result.filter((l) => l.bedrooms !== null && l.bedrooms >= filters.bedroomsMin!);
  }

  if (filters.priceMax !== null) {
    result = result.filter((l) => l.price <= filters.priceMax!);
  }

  if (filters.neighborhood) {
    const normTarget = normNeighborhood(filters.neighborhood);
    result = result.filter((l) => l.neighborhood && normNeighborhood(l.neighborhood) === normTarget);
  }

  // Sort
  result = [...result].sort((a, b) => {
    switch (filters.sort) {
      case 'price_asc':  return a.price - b.price;
      case 'price_desc': return b.price - a.price;
      case 'area_desc':  return (b.areaSqm ?? 0) - (a.areaSqm ?? 0);
      case 'score':
      default:           return (b.fitScore ?? 0) - (a.fitScore ?? 0);
    }
  });

  return result;
}
