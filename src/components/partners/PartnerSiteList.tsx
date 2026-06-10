'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Globe, RefreshCw, Loader, CheckCircle, Clock, AlertTriangle, Scan,
  ArrowDownAZ, ArrowUpDown, Pencil, Check, X, Eye, Play, Search, Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PartnerSiteForm } from './PartnerSiteForm';
import { apiFetch } from '@/lib/api-fetch';
import {
  selectionAnalysis,
  toggleSelectionIds,
  toggleSelectAllIds,
} from '@/lib/partner-site-selection';

function SiteFavicon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <Globe className="w-3.5 h-3.5 text-secondary" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      alt={domain}
      title={domain}
      width={16}
      height={16}
      className="rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}

interface PartnerSite {
  id: string;
  domain: string;
  baseUrl: string;
  name: string;
  discoveryStrategy: string;
  active: boolean;
  dismissed?: boolean;
  lastDiscoveredAt: string | null;
  lastScrapedAt: string | null;
  propertyUrlPatterns: string[];
  listingUrlPatterns: string[];
  seedUrls: string[];
  profileLocked: boolean;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  discoveryLockedAt: string | null;
  syncStatus: string;
  listingCount: number;
  _count?: { propertySources: number };
}

interface Props {
  /** When provided, renders a 2-column grid with checkboxes for briefing selection. */
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Maximum number of sites that can be selected simultaneously. */
  maxSelectable?: number;
}

// ─── sort helpers (module-level for stable identity) ─────────────────────────

function siteTier(s: PartnerSite): number {
  if (s.consecutiveFailures >= 5) return 4;
  const hasProfile = s.propertyUrlPatterns.length > 0 || s.listingUrlPatterns.length > 0
    || (!!s.discoveryStrategy && s.discoveryStrategy !== 'map_then_scrape')
    || s.listingCount > 0;
  if (hasProfile && s.syncStatus !== 'running' && s.discoveryLockedAt === null) return 0;
  if (s.syncStatus === 'running') return 1;
  if (s.discoveryLockedAt !== null) return 2;
  return 3;
}

function applySort(list: PartnerSite[], order: 'status' | 'alpha'): PartnerSite[] {
  if (order === 'alpha') {
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }
  return [...list].sort((a, b) => siteTier(a) - siteTier(b));
}

// ─── component ────────────────────────────────────────────────────────────────

export function PartnerSiteList({ selectable, selectedIds = [], onSelectionChange, maxSelectable }: Props) {
  const [sites, setSites] = useState<PartnerSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<Record<string, { fetched: number; added: number; total?: number }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const [sortOrder, setSortOrder] = useState<'status' | 'alpha'>('status');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showDismissed, setShowDismissed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sites that should auto-trigger sync once their discovery completes
  const pendingAutoSyncRef = useRef<Set<string>>(new Set());

  const fetchSites = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/partner-sites');
      if (!res.ok) return;
      const data = (await res.json()) as { data: PartnerSite[] };
      setSites(data.data ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  // Auto-poll while any site is discovering or syncing.
  // Also auto-triggers sync when discovery completes for newly-added sites.
  useEffect(() => {
    const hasPending = sites.some(
      (s) => s.discoveryLockedAt !== null || s.syncStatus === 'running',
    );

    // Check if any pending-auto-sync sites finished discovery
    if (pendingAutoSyncRef.current.size > 0 && !syncingId) {
      for (const pendingId of [...pendingAutoSyncRef.current]) {
        const s = sites.find((site) => site.id === pendingId);
        if (s && s.discoveryLockedAt === null) {
          pendingAutoSyncRef.current.delete(pendingId);
          const hasProfile = s.propertyUrlPatterns.length > 0 || s.listingUrlPatterns.length > 0 || !!s.discoveryStrategy || s.listingCount > 0;
          if (hasProfile) handleSync(pendingId);
        }
      }
    }

    if (hasPending || pendingAutoSyncRef.current.size > 0) {
      pollRef.current = setTimeout(() => { void fetchSites(); }, 5_000);
    }
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, fetchSites, syncingId]);

  useEffect(() => { void fetchSites(); }, [fetchSites]);

  // Abort any in-flight sync stream on unmount
  useEffect(() => () => { streamAbortRef.current?.abort(); }, []);

  // ── derived ────────────────────────────────────────────────────────────────

  const searchLower = search.toLowerCase();
  const visibleSites = applySort(
    sites.filter((s) => !s.dismissed && (
      !searchLower ||
      s.name.toLowerCase().includes(searchLower) ||
      s.domain.toLowerCase().includes(searchLower)
    )),
    sortOrder,
  );
  const dismissedSites = sites.filter((s) => s.dismissed);
  const dismissedCount = dismissedSites.length;

  // Selection analysis for summary (selectable mode only)
  const { indexedCount: indexedSelectedCount, liveCount: liveSelectedCount, noProfileCount: noProfileSelectedCount, estimatedTime } =
    selectionAnalysis(sites, selectable ? selectedIds : []);

  // ── handlers ───────────────────────────────────────────────────────────────

  async function handleDiscover(id: string) {
    setDiscoveringId(id);
    setDiscoverError(null);
    try {
      const res = await apiFetch(`/api/v1/partner-sites/${id}/discover`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { user_message?: string } };
        setDiscoverError(body.error?.user_message ?? `Erro ao remapear (HTTP ${res.status})`);
        return;
      }
      const data = (await res.json()) as { data: PartnerSite };
      const updated = data.data;
      setSites((prev) => prev.map((s) => s.id === id ? updated : s));
      const foundPatterns = updated.propertyUrlPatterns.length > 0
        || updated.listingUrlPatterns.length > 0
        || (!!updated.discoveryStrategy && updated.discoveryStrategy !== 'map_then_scrape');
      if (!foundPatterns) {
        setDiscoverError(
          'Nenhum padrão encontrado. O site pode usar JavaScript para carregar imóveis (SPA) ' +
          'ou estar bloqueando o mapeador. Configure seedUrls manualmente.',
        );
      }
    } catch {
      setDiscoverError('Falha de conexão ao remapear. Verifique o Firecrawl self-hosted.');
    } finally {
      setDiscoveringId(null);
      void fetchSites();
    }
  }

  function handleSync(id: string) {
    if (syncingId) return;
    setSyncingId(id);
    setSyncError(null);

    // Capture pre-sync listing count so we can distinguish a true empty-sync
    // (MAP found nothing) from a normal delta-sync with no new listings.
    const preSyncCount = sites.find((s) => s.id === id)?.listingCount ?? 0;

    streamAbortRef.current?.abort();
    const ctrl = new AbortController();
    streamAbortRef.current = ctrl;

    void (async () => {
      try {
        const res = await apiFetch(`/api/v1/partner-sites/${id}/sync/stream`, {
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          setSyncError(`Erro ao iniciar sincronização (HTTP ${res.status}).`);
          setSyncingId(null);
          setSyncProgress((prev) => { const next = { ...prev }; delete next[id]; return next; });
          void fetchSites();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE events are delimited by double newlines
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const line = part.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const data = JSON.parse(line.slice(6)) as {
                done?: boolean; error?: string;
                phase?: string; fetched?: number; added?: number; total?: number;
              };
              if (data.error) {
                setSyncError(`Erro na sincronização: ${data.error}`);
                setSyncingId(null);
                setSyncProgress((prev) => { const next = { ...prev }; delete next[id]; return next; });
                void fetchSites();
                return;
              } else if (data.done) {
                const added = (data as Record<string, unknown>).added as number ?? 0;
                const finalTotal = (data as Record<string, unknown>).total as number | undefined;
                // Show 100% briefly before clearing
                setSyncProgress((prev) => ({
                  ...prev,
                  [id]: {
                    fetched: finalTotal ?? prev[id]?.fetched ?? 0,
                    added,
                    total: finalTotal ?? prev[id]?.total,
                  },
                }));
                setSyncingId(null);
                void fetchSites();
                setTimeout(() => {
                  setSyncProgress((prev) => { const next = { ...prev }; delete next[id]; return next; });
                }, 2000);
                // Only warn when the site had no listings before AND still has none after —
                // a delta re-sync with 0 new listings is normal, not an error.
                if (added === 0 && preSyncCount === 0) {
                  setSyncError(
                    'Sincronização concluída sem adicionar imóveis. ' +
                    'O site pode usar JavaScript (SPA) ou os padrões de URL não encontraram listagens. ' +
                    'Execute "Remapear" primeiro ou configure seedUrls manualmente.',
                  );
                }
                return;
              } else {
                setSyncProgress((prev) => ({
                  ...prev,
                  [id]: { fetched: data.fetched ?? 0, added: data.added ?? 0, total: data.total },
                }));
              }
            } catch { /* malformed event — ignore */ }
          }
        }

        // Stream ended cleanly without an explicit done event
        setSyncingId(null);
        setTimeout(() => {
          setSyncProgress((prev) => { const next = { ...prev }; delete next[id]; return next; });
        }, 2000);
        void fetchSites();
      } catch (err) {
        if (ctrl.signal.aborted) return; // intentional cancel — no error to show
        setSyncError('Falha na conexão com o servidor. Tente novamente.');
        setSyncingId(null);
        setSyncProgress((prev) => { const next = { ...prev }; delete next[id]; return next; });
        void fetchSites();
      }
    })();
  }

  async function handleDismiss(id: string) {
    // Optimistic update
    setSites((prev) => prev.map((s) => s.id === id ? { ...s, dismissed: true } : s));
    onSelectionChange?.(selectedIds.filter((sid) => sid !== id));
    try {
      await apiFetch(`/api/v1/partner-sites/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      });
    } catch {
      // Rollback on failure
      setSites((prev) => prev.map((s) => s.id === id ? { ...s, dismissed: false } : s));
    }
  }

  async function handleRestore(id: string) {
    setSites((prev) => prev.map((s) => s.id === id ? { ...s, dismissed: false } : s));
    try {
      await apiFetch(`/api/v1/partner-sites/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: false }),
      });
    } catch {
      setSites((prev) => prev.map((s) => s.id === id ? { ...s, dismissed: true } : s));
    }
  }

  function startEdit(site: PartnerSite) {
    setEditingId(site.id);
    setEditName(site.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
  }

  async function saveEdit(id: string) {
    const name = editName.trim();
    setEditingId(null);
    setEditName('');
    if (!name) return;
    const current = sites.find((s) => s.id === id);
    if (current?.name === name) return;
    setSavingId(id);
    try {
      const res = await apiFetch(`/api/v1/partner-sites/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = (await res.json()) as { data: PartnerSite };
        setSites((prev) => prev.map((s) => s.id === id ? data.data : s));
      }
    } catch { /* ignore */ }
    finally { setSavingId(null); }
  }

  function toggleSelection(id: string) {
    if (!onSelectionChange) return;
    onSelectionChange(toggleSelectionIds(id, sites, selectedIds, maxSelectable));
  }

  function toggleSelectAll() {
    if (!onSelectionChange) return;
    if (selectedIds.length > 0) {
      onSelectionChange([]);
    } else {
      onSelectionChange(toggleSelectAllIds(visibleSites.map((s) => s.id), selectedIds, maxSelectable));
    }
  }

  function handleSiteAdded(site: PartnerSite) {
    setSites((prev) => prev.some((s) => s.id === site.id) ? prev : [...prev, site]);
    // When a new site is added, auto-trigger sync once its discovery completes
    pendingAutoSyncRef.current.add(site.id);
    // Ensure the poll loop starts
    void fetchSites();
  }

  // ── loading skeleton ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[72px] bg-skeleton rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">

      {/* Operation error banners */}
      {(discoverError ?? syncError) && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span className="flex-1">{discoverError ?? syncError}</span>
          <button onClick={() => { setDiscoverError(null); setSyncError(null); }} className="flex-shrink-0 hover:opacity-70">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Search field — selectable mode only */}
      {selectable && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar imobiliária…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/60 placeholder:text-muted-foreground/60"
          />
        </div>
      )}

      {/* Controls bar */}
      {sites.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground">Ordenar:</span>
          <button
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
              sortOrder === 'status'
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={() => setSortOrder('status')}
          >
            <ArrowUpDown className="w-3 h-3" />
            Status
          </button>
          <button
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
              sortOrder === 'alpha'
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={() => setSortOrder('alpha')}
          >
            <ArrowDownAZ className="w-3 h-3" />
            A–Z
          </button>
          {selectable && (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={toggleSelectAll}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs border border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors"
              >
                {selectedIds.length > 0 ? 'Desmarcar todas' : 'Selecionar todas'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {visibleSites.length === 0 && dismissedCount === 0 && (
        <p className="text-xs text-muted-foreground">Nenhum site parceiro cadastrado.</p>
      )}

      {/* Site grid / list */}
      <div className={selectable ? 'space-y-2 max-h-[420px] overflow-y-auto pr-0.5' : 'space-y-2'}>
        {visibleSites.map((site) => {
          const isSelected = selectedIds.includes(site.id);
          const isDiscovering = discoveringId === site.id;
          const isSyncingThis = syncingId === site.id;
          const progress = syncProgress[site.id];
          const isSaving = savingId === site.id;
          const isEditing = editingId === site.id;
          // hasProfile = site was actually discovered (not just default strategy value)
          const hasProfile = site.propertyUrlPatterns.length > 0 || site.listingUrlPatterns.length > 0
            || (!!site.discoveryStrategy && site.discoveryStrategy !== 'map_then_scrape')
            || site.listingCount > 0;
          const isCircuitOpen = site.consecutiveFailures >= 5;
          const hasWarning = site.consecutiveFailures > 0 && site.consecutiveFailures < 5;
          const isMappingInBackground = site.discoveryLockedAt !== null;
          const isSyncing = site.syncStatus === 'running' || isSyncingThis;
          const syncedCount = site._count?.propertySources ?? 0;
          const isFullySynced = site.listingCount > 0 && site.lastScrapedAt !== null && syncedCount >= site.listingCount;

          return (
            <div
              key={site.id}
              className={`group relative flex flex-col gap-2 rounded-lg border p-3 transition-colors ${
                selectable
                  ? isSelected
                    ? 'border-primary bg-primary/5 cursor-pointer'
                    : 'border-border bg-muted/20 cursor-pointer hover:border-primary/40'
                  : 'border-border bg-muted/20'
              }`}
              onClick={selectable && !isEditing ? () => toggleSelection(site.id) : undefined}
            >
              {/* Row 1: checkbox + icon + name + action icons */}
              <div className="flex items-start gap-2">
                {selectable && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelection(site.id)}
                    className="mt-0.5 w-4 h-4 accent-primary flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}

                <div className="w-7 h-7 rounded-md bg-secondary/10 flex items-center justify-center flex-shrink-0">
                  {isSaving
                    ? <Loader className="w-3.5 h-3.5 text-secondary animate-spin" />
                    : <SiteFavicon domain={site.domain} />
                  }
                </div>

                {/* Name + domain */}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveEdit(site.id);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        className="flex-1 min-w-0 text-sm font-semibold bg-background border border-primary/60 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      />
                      <button
                        onClick={() => void saveEdit(site.id)}
                        className="p-0.5 text-success hover:text-success/80"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm font-semibold text-foreground truncate leading-tight">
                      {site.name}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground truncate">{site.domain}</p>
                </div>


                {/* Action icons — visible on hover, hidden in selectable (briefing) mode */}
                {!selectable && <div
                  className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    title="Editar nome"
                    onClick={() => startEdit(site)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    title={isMappingInBackground ? 'Mapeamento em andamento' : 'Remapear padrões de URL'}
                    disabled={isDiscovering || isMappingInBackground}
                    onClick={() => void handleDiscover(site.id)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    {isDiscovering
                      ? <Loader className="w-3 h-3 animate-spin" />
                      : <RefreshCw className="w-3 h-3" />
                    }
                  </button>
                  {hasProfile && (
                    <button
                      title={
                        isSyncingThis ? 'Sincronizando…'
                        : isFullySynced ? 'Todos os imóveis já estão no banco — sincronização bloqueada para evitar retrabalho'
                        : 'Sincronizar estoque agora'
                      }
                      disabled={isSyncingThis || !!syncingId || isFullySynced}
                      onClick={() => handleSync(site.id)}
                      className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
                    >
                      {isSyncingThis
                        ? <Loader className="w-3 h-3 animate-spin text-primary" />
                        : isFullySynced
                        ? <CheckCircle className="w-3 h-3 text-success" />
                        : <Play className="w-3 h-3" />
                      }
                    </button>
                  )}
                  <button
                    title="Remover da minha lista"
                    onClick={() => void handleDismiss(site.id)}
                    className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>}
              </div>

              {/* Row 2: status badges */}
              <div className="flex flex-wrap items-center gap-1">
                {isCircuitOpen ? (
                  <Badge
                    className="gap-1 bg-destructive/10 text-destructive hover:bg-destructive/10 text-xs"
                    title={`${site.consecutiveFailures} falhas consecutivas — coleta pausada`}
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Pausado
                  </Badge>
                ) : isMappingInBackground ? (
                  <Badge
                    className="gap-1 bg-primary/10 text-primary hover:bg-primary/10 text-xs"
                    title="Mapeando padrões de URL em segundo plano"
                  >
                    <Scan className="w-3 h-3 animate-pulse" />
                    Mapeando…
                  </Badge>
                ) : hasProfile ? (
                  !selectable ? (
                    <>
                      <Badge
                        className="gap-1 bg-success/10 text-success hover:bg-success/10 text-xs"
                        title={site.listingCount > 0 ? `${site.listingCount} imóveis indexados` : 'Padrões de URL configurados'}
                      >
                        <CheckCircle className="w-3 h-3" />
                        {site.listingCount > 0
                          ? `${site.listingCount.toLocaleString('pt-BR')} imóveis`
                          : 'Configurado'}
                      </Badge>
                      {isFullySynced && (
                        <Badge
                          className="gap-1 bg-success/20 text-success border border-success/30 hover:bg-success/20 text-xs"
                          title={`${syncedCount.toLocaleString('pt-BR')} imóveis raspados — nenhum pendente`}
                        >
                          <CheckCircle className="w-3 h-3" />
                          Completo
                        </Badge>
                      )}
                    </>
                  ) : null
                ) : (
                  <Badge
                    className="gap-1 bg-warning/10 text-warning hover:bg-warning/10 text-xs"
                    title="Ainda sem padrões de URL — clique em ↺ para mapear"
                  >
                    <Clock className="w-3 h-3" />
                    Sem perfil
                  </Badge>
                )}

                {(isSyncing || !!progress) && !isMappingInBackground && (
                  <Badge className="gap-1 bg-primary/10 text-primary hover:bg-primary/10 text-xs">
                    <Loader className="w-3 h-3 animate-spin" />
                    {progress
                      ? `${progress.fetched.toLocaleString('pt-BR')} / ${progress.total?.toLocaleString('pt-BR') ?? '…'}`
                      : 'Sincronizando…'
                    }
                  </Badge>
                )}

                {hasWarning && (
                  <Badge
                    className="gap-1 bg-warning/10 text-warning hover:bg-warning/10 text-xs"
                    title={`${site.consecutiveFailures} falha(s) recente(s) na coleta`}
                  >
                    <AlertTriangle className="w-3 h-3" />
                    {site.consecutiveFailures}×
                  </Badge>
                )}


              </div>
            </div>
          );
        })}

        {/* Dismissed sites (collapsed) */}
        {showDismissed && dismissedSites.map((site) => (
          <div
            key={site.id}
            className="flex items-center gap-2 rounded-lg border border-dashed border-border/50 bg-muted/10 p-3 opacity-50"
          >
            <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground truncate">{site.name}</p>
              <p className="text-xs text-muted-foreground/60 truncate">{site.domain}</p>
            </div>
            <button
              title="Restaurar na minha lista"
              onClick={() => void handleRestore(site.id)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Dismissed sites toggle */}
      {dismissedCount > 0 && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          onClick={() => setShowDismissed((v) => !v)}
        >
          {showDismissed ? <X className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {showDismissed
            ? 'Ocultar removidos'
            : `${dismissedCount} site${dismissedCount !== 1 ? 's' : ''} removido${dismissedCount !== 1 ? 's' : ''} da lista`}
        </button>
      )}


      {/* Warnings */}
      {selectable && maxSelectable !== undefined && selectedIds.length >= maxSelectable && (
        <p className="text-xs text-warning font-medium flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Limite de {maxSelectable} sites atingido. Desmarque um para trocar.
        </p>
      )}
      {selectable && liveSelectedCount > 0 && selectedIds.length < (maxSelectable ?? Infinity) && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 text-warning" />
          Já há 1 site ao vivo selecionado. Os próximos precisam ter estoque indexado.
        </p>
      )}

      <PartnerSiteForm onCreated={handleSiteAdded} />
    </div>
  );
}
