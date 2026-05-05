'use client';

import { useEffect, useRef, useState } from 'react';
import { PropertyCard, type PropertyCardData } from './PropertyCard';
import { WidenProposals, type WidenProposal } from './WidenProposals';
import { SearchFilters, applyFilters, type FilterState } from './SearchFilters';

interface SearchResultsProps {
  briefingId: string;
}

type SearchState = 'connecting' | 'searching' | 'done' | 'error';

export function SearchResults({ briefingId }: SearchResultsProps) {
  const [state, setState] = useState<SearchState>('connecting');
  const [listings, setListings] = useState<PropertyCardData[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState<number | null>(null);
  const [widenProposals, setWidenProposals] = useState<WidenProposal[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    sort: 'score',
    bedroomsMin: null,
    priceMax: null,
    neighborhood: null,
  });
  // Incremented when auto-widen is applied — triggers SSE reconnect via useEffect dependency
  const [searchEpoch, setSearchEpoch] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/v1/briefings/${briefingId}/stream`);
    eventSourceRef.current = es;

    es.addEventListener('status_update', (e) => {
      const data = JSON.parse(e.data) as { status: string };
      if (data.status === 'searching') setState('searching');
    });

    es.addEventListener('result_chunk', (e) => {
      const data = JSON.parse(e.data) as { listings: PropertyCardData[] };
      setState('searching');
      setListings((prev) => {
        // Deduplicate by id (SSE may re-send on reconnect)
        const ids = new Set(prev.map((p) => p.id));
        const incoming = data.listings.filter((l) => !ids.has(l.id));
        return [...prev, ...incoming];
      });
    });

    es.addEventListener('search_complete', (e) => {
      const data = JSON.parse(e.data) as { total: number; widenProposals?: WidenProposal[] };
      setTotal(data.total);
      setWidenProposals(data.widenProposals ?? []);
      setState('done');
      es.close();
    });

    es.addEventListener('search_error', (e) => {
      const data = JSON.parse(e.data) as { message: string };
      setErrorMsg(data.message);
      setState('error');
      es.close();
    });

    es.onerror = () => {
      setState('error');
      setErrorMsg('Conexão perdida. Recarregue a página para tentar novamente.');
      es.close();
    };

    return () => {
      es.close();
    };
  }, [briefingId, searchEpoch]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleWidenStarted() {
    setListings([]);
    setSelected(new Set());
    setTotal(null);
    setWidenProposals([]);
    setFilters({ sort: 'score', bedroomsMin: null, priceMax: null, neighborhood: null });
    setState('connecting');
    setSearchEpoch((e) => e + 1); // reconnects EventSource
  }

  if (state === 'connecting' || state === 'searching') {
    return (
      <div className="space-y-4">
        {/* Progress indicator */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            {state === 'connecting' ? 'Conectando…' : `Buscando imóveis${listings.length > 0 ? ` — ${listings.length} encontrados` : '…'}`}
          </p>
        </div>

        {/* Render results as they arrive */}
        {listings.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                selected={selected.has(p.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-2">
        <p className="font-medium text-destructive">Erro na busca</p>
        <p className="text-sm text-muted-foreground">{errorMsg}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 text-sm text-primary underline"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  // done
  const visible = applyFilters(listings, filters);

  return (
    <div className="space-y-4">
      {/* Auto-widen proposals — shown when < 5 results */}
      {widenProposals.length > 0 && (
        <WidenProposals
          briefingId={briefingId}
          proposals={widenProposals}
          onWidenStarted={handleWidenStarted}
        />
      )}

      {/* Filters + sort */}
      {listings.length > 1 && (
        <SearchFilters listings={listings} filters={filters} onChange={setFilters} />
      )}

      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {visible.length} de {total ?? listings.length} imóveis
          {selected.size > 0 && ` · ${selected.size} selecionados`}
        </p>
        {selected.size > 0 && (
          <button
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            onClick={() => {
              /* MSG-1 Sprint 6 — generate WhatsApp message */
            }}
          >
            Gerar mensagem WhatsApp ({selected.size})
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">
            {listings.length === 0
              ? 'Nenhum imóvel encontrado com esses critérios.'
              : 'Nenhum imóvel corresponde aos filtros selecionados.'}
          </p>
          {listings.length > 0 && (
            <button
              onClick={() => setFilters({ sort: 'score', bedroomsMin: null, priceMax: null, neighborhood: null })}
              className="mt-3 text-sm text-primary underline"
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <PropertyCard
              key={p.id}
              property={p}
              selected={selected.has(p.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
