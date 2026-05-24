'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Globe, RefreshCw, Loader, CheckCircle, Clock, AlertTriangle, Scan,
  ArrowDownAZ, ArrowUpDown, Pencil, EyeOff, Check, X, Eye, Play,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PartnerSiteForm } from './PartnerSiteForm';
import { apiFetch } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';
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
  const hasProfile = s.propertyUrlPatterns.length > 0 || s.listingUrlPatterns.length > 0 || !!s.discoveryStrategy || s.listingCount > 0;
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

// ─── hide persistence (localStorage, per-device) ─────────────────────────────

const HIDDEN_KEY = 'propmatch_hidden_sites';

function readHidden(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as string[]; } catch { return []; }
}

function writeHidden(ids: string[]): void {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
}

// ─── component ────────────────────────────────────────────────────────────────

export function PartnerSiteList({ selectable, selectedIds = [], onSelectionChange, maxSelectable }: Props) {
  const [sites, setSites] = useState<PartnerSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<Record<string, { fetched: number; added: number; total?: number }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const [sortOrder, setSortOrder] = useState<'status' | 'alpha'>('status');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [hiddenIds, setHiddenIds] = useState<string[]>(readHidden);
  const [showHidden, setShowHidden] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  useEffect(() => {
    const hasPending = sites.some(
      (s) => s.discoveryLockedAt !== null || s.syncStatus === 'running',
    );
    if (hasPending) {
      pollRef.current = setTimeout(() => { void fetchSites(); }, 5_000);
    }
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [sites, fetchSites]);

  useEffect(() => { void fetchSites(); }, [fetchSites]);

  // Close EventSource on unmount to avoid memory leaks
  useEffect(() => () => { esRef.current?.close(); }, []);

  // ── derived ────────────────────────────────────────────────────────────────

  const visibleSites = applySort(
    sites.filter((s) => !hiddenIds.includes(s.id)),
    sortOrder,
  );
  const hiddenCount = sites.filter((s) => hiddenIds.includes(s.id)).length;

  // Selection analysis for summary (selectable mode only)
  const { indexedCount: indexedSelectedCount, liveCount: liveSelectedCount, noProfileCount: noProfileSelectedCount, estimatedTime } =
    selectionAnalysis(sites, selectable ? selectedIds : []);

  // ── handlers ───────────────────────────────────────────────────────────────

  async function handleDiscover(id: string) {
    setDiscoveringId(id);
    try {
      const res = await apiFetch(`/api/v1/partner-sites/${id}/discover`, { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as { data: PartnerSite };
        setSites((prev) => prev.map((s) => s.id === id ? data.data : s));
      }
    } catch { /* ignore */ }
    finally {
      setDiscoveringId(null);
      // Always refetch to get the latest state from DB (listingCount, discoveryStrategy, etc.)
      void fetchSites();
    }
  }

  function handleSync(id: string) {
    if (syncingId) return;
    setSyncingId(id);

    esRef.current?.close();
    const es = new EventSource(`/api/v1/partner-sites/${id}/sync/stream`);
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as {
          done?: boolean; error?: string;
          phase?: string; fetched?: number; added?: number; total?: number;
        };
        if (data.done || data.error) {
          es.close();
          esRef.current = null;
          setSyncingId(null);
          setSyncProgress((prev) => { const next = { ...prev }; delete next[id]; return next; });
          void fetchSites();
        } else {
          setSyncProgress((prev) => ({
            ...prev,
            [id]: { fetched: data.fetched ?? 0, added: data.added ?? 0, total: data.total },
          }));
        }
      } catch { /* malformed event — ignore */ }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setSyncingId(null);
      setSyncProgress((prev) => { const next = { ...prev }; delete next[id]; return next; });
      void fetchSites();
    };
  }

  function handleHide(id: string) {
    const updated = [...new Set([...hiddenIds, id])];
    writeHidden(updated);
    setHiddenIds(updated);
    onSelectionChange?.(selectedIds.filter((sid) => sid !== id));
  }

  function handleUnhide(id: string) {
    const updated = hiddenIds.filter((hid) => hid !== id);
    writeHidden(updated);
    setHiddenIds(updated);
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
    onSelectionChange(toggleSelectAllIds(visibleSites.map((s) => s.id), selectedIds, maxSelectable));
  }

  function handleSiteAdded(site: PartnerSite) {
    setSites((prev) => prev.some((s) => s.id === site.id) ? prev : [...prev, site]);
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
              {selectedIds.length > 0 && (
                <span className="text-xs text-primary font-medium">
                  {selectedIds.length} selecionado{selectedIds.length !== 1 ? 's' : ''}
                </span>
              )}
              <button
                onClick={toggleSelectAll}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs border border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors"
              >
                {visibleSites.length > 0 && visibleSites.every((s) => selectedIds.includes(s.id))
                  ? 'Desmarcar todas'
                  : 'Selecionar todas'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {visibleSites.length === 0 && hiddenCount === 0 && (
        <p className="text-xs text-muted-foreground">Nenhum site parceiro cadastrado.</p>
      )}

      {/* Site grid / list */}
      <div className="space-y-2">
        {visibleSites.map((site) => {
          const isSelected = selectedIds.includes(site.id);
          const isDiscovering = discoveringId === site.id;
          const isSyncingThis = syncingId === site.id;
          const progress = syncProgress[site.id];
          const isSaving = savingId === site.id;
          const isEditing = editingId === site.id;
          const hasProfile = site.propertyUrlPatterns.length > 0 || site.listingUrlPatterns.length > 0 || !!site.discoveryStrategy || site.listingCount > 0;
          const isCircuitOpen = site.consecutiveFailures >= 5;
          const hasWarning = site.consecutiveFailures > 0 && site.consecutiveFailures < 5;
          const isMappingInBackground = site.discoveryLockedAt !== null;
          const isSyncing = site.syncStatus === 'running' || isSyncingThis;

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

                {/* Action icons — visible on hover */}
                <div
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
                      title={isSyncingThis ? 'Sincronizando…' : 'Sincronizar estoque agora'}
                      disabled={isSyncingThis || !!syncingId}
                      onClick={() => handleSync(site.id)}
                      className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
                    >
                      {isSyncingThis
                        ? <Loader className="w-3 h-3 animate-spin text-primary" />
                        : <Play className="w-3 h-3" />
                      }
                    </button>
                  )}
                  <button
                    title="Ocultar da minha lista"
                    onClick={() => handleHide(site.id)}
                    className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <EyeOff className="w-3 h-3" />
                  </button>
                </div>
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
                  <Badge
                    className="gap-1 bg-success/10 text-success hover:bg-success/10 text-xs"
                    title={site.listingCount > 0 ? `${site.listingCount} imóveis indexados` : 'Padrões de URL configurados'}
                  >
                    <CheckCircle className="w-3 h-3" />
                    {site.listingCount > 0
                      ? `${site.listingCount.toLocaleString('pt-BR')} imóveis`
                      : 'Configurado'}
                  </Badge>
                ) : (
                  <Badge
                    className="gap-1 bg-warning/10 text-warning hover:bg-warning/10 text-xs"
                    title="Ainda sem padrões de URL — clique em ↺ para mapear"
                  >
                    <Clock className="w-3 h-3" />
                    Sem perfil
                  </Badge>
                )}

                {isSyncing && !isMappingInBackground && (
                  <Badge className="gap-1 bg-primary/10 text-primary hover:bg-primary/10 text-xs">
                    <Loader className="w-3 h-3 animate-spin" />
                    {isSyncingThis && progress
                      ? `${progress.added.toLocaleString('pt-BR')} adicionados${progress.total ? ` / ${progress.total.toLocaleString('pt-BR')}` : ''}…`
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

                {/* Speed indicator — only in selectable mode */}
                {selectable && !isCircuitOpen && (
                  <span
                    className={cn(
                      'ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded',
                      site.listingCount > 0
                        ? 'bg-success/10 text-success'
                        : hasProfile
                          ? 'bg-warning/10 text-warning'
                          : 'bg-muted text-muted-foreground',
                    )}
                    title={
                      site.listingCount > 0
                        ? 'Estoque indexado — busca rápida'
                        : hasProfile
                          ? 'Busca ao vivo via scraping — mais lento'
                          : 'Sem sync — site será ignorado na busca'
                    }
                  >
                    {site.listingCount > 0 ? '⚡ Indexado' : hasProfile ? '⏱ Ao vivo' : '— Sem sync'}
                  </span>
                )}

              </div>
            </div>
          );
        })}

        {/* Hidden sites (collapsed) */}
        {showHidden && sites
          .filter((s) => hiddenIds.includes(s.id))
          .map((site) => (
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
                title="Mostrar novamente"
                onClick={() => handleUnhide(site.id)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        }
      </div>

      {/* Hidden sites toggle */}
      {hiddenCount > 0 && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          onClick={() => setShowHidden((v) => !v)}
        >
          {showHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {showHidden
            ? 'Ocultar sites escondidos'
            : `${hiddenCount} site${hiddenCount !== 1 ? 's' : ''} oculto${hiddenCount !== 1 ? 's' : ''}`}
        </button>
      )}

      {/* Selection summary (selectable mode only) */}
      {selectable && selectedIds.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 space-y-1">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {indexedSelectedCount > 0 && (
              <span className="text-success font-medium">⚡ {indexedSelectedCount} indexado{indexedSelectedCount !== 1 ? 's' : ''}</span>
            )}
            {liveSelectedCount > 0 && (
              <span className="text-warning font-medium">⏱ {liveSelectedCount} ao vivo</span>
            )}
            {noProfileSelectedCount > 0 && (
              <span className="text-destructive font-medium">⚠ {noProfileSelectedCount} sem sync</span>
            )}
            <span className="ml-auto">Estimado: {estimatedTime}</span>
          </div>
          {noProfileSelectedCount > 0 && (
            <p className="text-[10px] text-muted-foreground">Sites sem sync serão ignorados na busca.</p>
          )}
        </div>
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
