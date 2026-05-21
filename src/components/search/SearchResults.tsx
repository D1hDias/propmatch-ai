'use client';

import { useEffect, useRef, useState } from 'react';
import { PropertyCard, PropertyCardSkeleton, type PropertyCardData } from './PropertyCard';
import { WidenProposals, type WidenProposal } from './WidenProposals';
import { SearchFilters, applyFilters, type FilterState } from './SearchFilters';
import { WhatsAppMessageModal } from '@/components/messaging/WhatsAppMessageModal';
import { getFreshToken } from '@/lib/api-fetch';

const LOADING_MESSAGES = [
  'Estamos vasculhando os parceiros em busca do imóvel ideal…',
  'Analisando os imóveis disponíveis na região…',
  'Filtrando as melhores opções dentro do seu orçamento…',
  'Cruzando localização, preço e características solicitadas…',
  'Quase lá — verificando os últimos detalhes de cada imóvel…',
  'Buscando com precisão tudo que foi solicitado…',
  'Comparando preços e condições para trazer o melhor resultado…',
  'Conferindo disponibilidade e dados de cada anúncio…',
];

interface SearchResultsProps {
  briefingId: string;
}

type SearchState = 'connecting' | 'searching' | 'done' | 'error';

interface CustomUrlResult {
  url: string;
  count: number;
  error?: string;
}

export function SearchResults({ briefingId }: SearchResultsProps) {
  const [state, setState] = useState<SearchState>('connecting');
  const [listings, setListings] = useState<PropertyCardData[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState<number | null>(null);
  const [widenProposals, setWidenProposals] = useState<WidenProposal[]>([]);
  const [customUrlResults, setCustomUrlResults] = useState<CustomUrlResult[]>([]);
  const [belowThresholdCount, setBelowThresholdCount] = useState<number>(0);
  const [filters, setFilters] = useState<FilterState>({
    sort: 'score',
    bedroomsMin: null,
    priceMax: null,
    neighborhood: null,
  });
  // Incremented when auto-widen is applied — triggers SSE reconnect via useEffect dependency
  const [searchEpoch, setSearchEpoch] = useState(0);
  const [visibleCount, setVisibleCount] = useState(10);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Cycle through loading messages every 4 s while searching with no results yet
  useEffect(() => {
    if (state !== 'searching' && state !== 'connecting') return;
    if (listings.length > 0) return;
    const id = setInterval(() => {
      setLoadingMsgIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 4000);
    return () => clearInterval(id);
  }, [state, listings.length]);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    void getFreshToken().then((token) => {
      if (cancelled) return;
      const url = `/api/v1/briefings/${briefingId}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      es = new EventSource(url);
      eventSourceRef.current = es;

      es.addEventListener('status_update', (e) => {
        const data = JSON.parse(e.data) as { status: string };
        if (data.status === 'searching') setState('searching');
      });

      es.addEventListener('result_chunk', (e) => {
        const data = JSON.parse(e.data) as { listings: PropertyCardData[] };
        setState('searching');
        setListings((prev) => {
          const ids = new Set(prev.map((p) => p.id));
          const incoming = data.listings.filter((l) => !ids.has(l.id));
          return [...prev, ...incoming];
        });
      });

      es.addEventListener('search_complete', (e) => {
        const data = JSON.parse(e.data) as { total: number; widenProposals?: WidenProposal[]; customUrlResults?: CustomUrlResult[]; belowThresholdCount?: number };
        setTotal(data.total);
        setWidenProposals(data.widenProposals ?? []);
        setCustomUrlResults(data.customUrlResults ?? []);
        setBelowThresholdCount(data.belowThresholdCount ?? 0);
        setState('done');
        es!.close();
      });

      es.addEventListener('search_error', (e) => {
        const data = JSON.parse(e.data) as { message: string };
        setErrorMsg(data.message);
        setState('error');
        es!.close();
      });

      es.onerror = () => {
        setState('error');
        setErrorMsg('Conexão perdida. Recarregue a página para tentar novamente.');
        es!.close();
      };
    });

    return () => {
      cancelled = true;
      es?.close();
      eventSourceRef.current = null;
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
    setCustomUrlResults([]);
    setBelowThresholdCount(0);
    setFilters({ sort: 'score', bedroomsMin: null, priceMax: null, neighborhood: null });
    setVisibleCount(10);
    setIsLoadingMore(false);
    setState('connecting');
    setSearchEpoch((e) => e + 1); // reconnects EventSource
  }

  function handleLoadMore(remaining: number) {
    setIsLoadingMore(true);
    setTimeout(() => {
      setVisibleCount((c) => c + 10);
      setIsLoadingMore(false);
    }, 380);
    void remaining; // used by caller for skeleton count
  }

  if (state === 'connecting' || state === 'searching') {
    const arrived = listings.length;

    // No results yet — spinner + rotating message + skeletons
    if (arrived === 0) {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
            <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p
              key={loadingMsgIndex}
              className="text-sm text-muted-foreground animate-fade-in-up"
            >
              {state === 'connecting' ? 'Conectando…' : LOADING_MESSAGES[loadingMsgIndex]}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <PropertyCardSkeleton key={`sk-${i}`} />
            ))}
          </div>
        </div>
      );
    }

    // Results arriving — show paginated cards + subtle "still searching" banner
    const visibleSearchSlice = listings.slice(0, visibleCount);
    const searchRemaining = arrived - visibleCount;

    return (
      <div className="space-y-4">
        {/* Subtle "still loading" banner */}
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p
            key={loadingMsgIndex}
            className="text-sm text-primary/80 animate-fade-in-up"
          >
            {LOADING_MESSAGES[loadingMsgIndex]}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {arrived} imóveis encontrados até agora
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visibleSearchSlice.map((p, i) => (
            <div key={p.id} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}>
              <PropertyCard
                property={p}
                selected={selected.has(p.id)}
                onToggleSelect={toggleSelect}
              />
            </div>
          ))}
          {isLoadingMore && Array.from({ length: Math.min(searchRemaining, 10) }).map((_, i) => (
            <PropertyCardSkeleton key={`lm-${i}`} />
          ))}
        </div>

        {searchRemaining > 0 && !isLoadingMore && (
          <div className="flex justify-center pt-2">
            <button
              onClick={() => handleLoadMore(searchRemaining)}
              className="rounded-xl border border-border bg-card px-8 py-3 text-sm font-semibold text-foreground shadow-sm hover:bg-muted hover:border-primary/40 active:scale-95 transition-all"
            >
              Ver mais
            </button>
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
  const visibleSlice = visible.slice(0, visibleCount);
  const remaining = visible.length - visibleCount;
  const nextBatch = Math.min(remaining, 10);

  return (
    <div className="space-y-4">
      {/* Custom URL results feedback — S11-4 */}
      {customUrlResults.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Links adicionados
          </p>
          <div className="space-y-1.5">
            {customUrlResults.map((r) => {
              const hostname = (() => { try { return new URL(r.url).hostname; } catch { return r.url; } })();
              const failed = r.error != null;
              return (
                <div key={r.url} className="flex items-center gap-2 text-sm">
                  <span className={`h-2 w-2 rounded-full flex-shrink-0 ${failed ? 'bg-[#FF5E5E]' : 'bg-[#4FD66E]'}`} />
                  <span className="text-foreground font-medium truncate max-w-[200px]">{hostname}</span>
                  {failed ? (
                    <span className="text-[#FF5E5E] text-xs">não foi possível acessar</span>
                  ) : (
                    <span className="text-muted-foreground text-xs" title="Imóveis coletados antes dos filtros de critérios">{r.count} {r.count === 1 ? 'imóvel coletado' : 'imóveis coletados'}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
        <SearchFilters
          listings={listings}
          filters={filters}
          onChange={(f) => { setFilters(f); setVisibleCount(10); }}
        />
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
            onClick={() => setShowModal(true)}
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
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visibleSlice.map((p, i) => (
              <div key={p.id} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}>
                <PropertyCard
                  property={p}
                  selected={selected.has(p.id)}
                  onToggleSelect={toggleSelect}
                />
              </div>
            ))}
            {isLoadingMore &&
              Array.from({ length: nextBatch }).map((_, i) => (
                <PropertyCardSkeleton key={`lm-${i}`} />
              ))
            }
          </div>

          {remaining > 0 && !isLoadingMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => handleLoadMore(remaining)}
                className="rounded-xl border border-border bg-card px-8 py-3 text-sm font-semibold text-foreground shadow-sm hover:bg-muted hover:border-primary/40 active:scale-95 transition-all"
              >
                Ver mais
              </button>
            </div>
          )}

          {isLoadingMore && (
            <div className="flex justify-center pt-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Carregando…
              </div>
            </div>
          )}
        </>
      )}

      {/* Below-threshold notice */}
      {belowThresholdCount > 0 && listings.length > 0 && (
        <div className="rounded-xl border border-[#FF9F00]/30 bg-[#FF9F00]/5 px-4 py-3 flex items-start gap-3">
          <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-[#FF9F00]" />
          <p className="text-sm text-muted-foreground">
            Encontramos mais{' '}
            <span className="font-medium text-foreground">
              {belowThresholdCount} {belowThresholdCount === 1 ? 'imóvel' : 'imóveis'}
            </span>{' '}
            com pontuação abaixo de 60%. Não os trouxemos nos resultados para aumentar sua efetividade nas negociações.
          </p>
        </div>
      )}

      {showModal && (
        <WhatsAppMessageModal
          briefingId={briefingId}
          selectedIds={[...selected]}
          listings={listings}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
