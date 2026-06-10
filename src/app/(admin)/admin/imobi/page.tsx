'use client';

import { useEffect, useState, useCallback } from 'react';
import { Trash2, Loader, AlertTriangle, X, RefreshCw, Play, Plus, ScanSearch, CheckCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface PartnerSite {
  id: string;
  name: string;
  domain: string;
  baseUrl: string;
  syncStatus: string;
  listingCount: number;
  consecutiveFailures: number;
  discoveryStrategy: string;
  lastScrapedAt: string | null;
  lastErrorAt: string | null;
  active: boolean;
  _count?: { propertySources: number };
}

export default function AdminImobiPage() {
  const [sites, setSites] = useState<PartnerSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const [detectingId, setDetectingId] = useState<string | null>(null);

  async function handleDetect(id: string) {
    if (detectingId) return;
    setDetectingId(id);
    try {
      await apiFetch(`/api/v1/partner-sites/${id}/discover`, { method: 'POST' });
      void fetchSites();
    } catch { /* ignore */ }
    finally { setDetectingId(null); }
  }

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addUrl.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await apiFetch('/api/v1/partner-sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: addUrl.trim(), name: addName.trim() || new URL(addUrl.trim()).hostname }),
      });
      const body = (await res.json()) as { data?: PartnerSite; error?: { user_message?: string } };
      if (!res.ok) {
        setAddError(body.error?.user_message ?? 'Erro ao cadastrar.');
        return;
      }
      if (body.data) setSites((prev) => [body.data!, ...prev]);
      setAddUrl('');
      setAddName('');
      setShowAdd(false);
    } catch {
      setAddError('Falha de conexão.');
    } finally {
      setAdding(false);
    }
  }

  const fetchSites = useCallback(async () => {
    const res = await apiFetch('/api/v1/admin/partner-sites');
    if (!res.ok) return;
    const data = (await res.json()) as { data: PartnerSite[] };
    setSites(data.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchSites(); }, [fetchSites]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/admin/partner-sites/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { user_message?: string } };
        setError(body.error?.user_message ?? 'Erro ao excluir.');
        return;
      }
      setSites((prev) => prev.filter((s) => s.id !== id));
    } catch {
      setError('Falha de conexão ao excluir.');
    } finally {
      setDeletingId(null);
      setConfirm(null);
    }
  }

  async function handleSync(id: string) {
    if (syncingId) return;
    setSyncingId(id);
    try {
      const res = await apiFetch(`/api/v1/partner-sites/${id}/sync/stream`);
      if (!res.ok || !res.body) { setSyncingId(null); return; }
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch { /* ignore */ }
    finally {
      setSyncingId(null);
      void fetchSites();
    }
  }

  const statusColor = (s: string) =>
    s === 'done' ? 'bg-success/10 text-success' :
    s === 'running' ? 'bg-primary/10 text-primary' :
    s === 'error' ? 'bg-destructive/10 text-destructive' :
    'bg-muted text-muted-foreground';

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Imobiliárias</h1>
          <p className="text-sm text-muted-foreground">{sites.length} sites cadastrados na plataforma</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void fetchSites()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => { setShowAdd((v) => !v); setAddError(null); }}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Cadastrar
          </Button>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={(e) => void handleAdd(e)} className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <p className="text-sm font-medium">Nova imobiliária</p>
          <div className="flex gap-2">
            <Input
              placeholder="URL do site (ex: https://exemplo.com.br)"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              className="flex-1"
              required
              type="url"
              disabled={adding}
            />
            <Input
              placeholder="Nome (opcional)"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              className="w-48"
              disabled={adding}
            />
            <Button type="submit" size="sm" disabled={adding || !addUrl.trim()}>
              {adding ? <Loader className="w-3.5 h-3.5 animate-spin" /> : 'Cadastrar'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowAdd(false)} disabled={adding}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          {addError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> {addError}
            </p>
          )}
        </form>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Site</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Estratégia</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Armazenados / Site</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Falhas</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sites.map((site) => (
                <tr key={site.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium">{site.name}</p>
                    <p className="text-xs text-muted-foreground">{site.domain}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                    {site.discoveryStrategy}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-medium">{(site._count?.propertySources ?? 0).toLocaleString('pt-BR')}</span>
                    <span className="text-muted-foreground text-xs"> / {site.listingCount.toLocaleString('pt-BR')}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor(site.syncStatus)}`}>
                      {site.syncStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {site.consecutiveFailures > 0 ? (
                      <Badge className="bg-warning/10 text-warning text-xs">
                        {site.consecutiveFailures}×
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const syncedCount = site._count?.propertySources ?? 0;
                      const isFullySynced = site.listingCount > 0 && site.lastScrapedAt !== null && syncedCount >= site.listingCount;
                      return (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title="Re-detectar plataforma"
                          disabled={!!detectingId || !!syncingId}
                          onClick={() => void handleDetect(site.id)}
                          className="p-1.5 rounded text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-40"
                        >
                          {detectingId === site.id
                            ? <Loader className="w-3.5 h-3.5 animate-spin" />
                            : <ScanSearch className="w-3.5 h-3.5" />
                          }
                        </button>
                        <button
                          title={isFullySynced ? 'Todos os imóveis já estão no banco — re-sync bloqueado por 1h' : 'Sincronizar agora'}
                          disabled={!!syncingId || !!detectingId || isFullySynced}
                          onClick={() => void handleSync(site.id)}
                          className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
                        >
                          {syncingId === site.id
                            ? <Loader className="w-3.5 h-3.5 animate-spin" />
                            : isFullySynced
                            ? <CheckCircle className="w-3.5 h-3.5 text-success" />
                            : <Play className="w-3.5 h-3.5" />
                          }
                        </button>
                      {confirm === site.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => void handleDelete(site.id)}
                            disabled={deletingId === site.id}
                            className="text-xs px-2 py-1 rounded bg-destructive text-destructive-foreground hover:bg-destructive/80 transition-colors disabled:opacity-50"
                          >
                            {deletingId === site.id ? <Loader className="w-3 h-3 animate-spin inline" /> : 'Confirmar'}
                          </button>
                          <button
                            onClick={() => setConfirm(null)}
                            className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          title="Excluir permanentemente"
                          onClick={() => setConfirm(site.id)}
                          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      </div>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
