'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader, RefreshCw, Building2, Users, FileText, Home, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { Button } from '@/components/ui/button';

interface Metrics {
  sites: {
    total: number;
    byStatus: Record<string, number>;
    top: { id: string; name: string; domain: string; listingCount: number; syncStatus: string; lastScrapedAt: string | null }[];
    recentErrors: { id: string; name: string; domain: string; consecutiveFailures: number; lastErrorAt: string | null }[];
  };
  listings: { total: number };
  users: {
    total: number;
    byRole: Record<string, number>;
    byPlan: Record<string, number>;
  };
  briefings: { total: number };
}

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-1">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value.toLocaleString('pt-BR')}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function DistBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground capitalize">{label}</span>
        <span className="font-medium">{value} <span className="text-muted-foreground">({pct}%)</span></span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AdminMetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch('/api/v1/admin/metrics');
    if (!res.ok) { setLoading(false); return; }
    const data = (await res.json()) as { data: Metrics };
    setMetrics(data.data);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { void fetchMetrics(); }, [fetchMetrics]);

  const statusColor = (s: string) =>
    s === 'done' ? 'bg-success' :
    s === 'running' ? 'bg-primary' :
    s === 'error' ? 'bg-destructive' :
    'bg-muted-foreground';

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Métricas do sistema</h1>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground">
              Atualizado às {lastUpdated.toLocaleTimeString('pt-BR')}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => void fetchMetrics()} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {loading && !metrics ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : metrics ? (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Building2} label="Sites ativos" value={metrics.sites.total} />
            <StatCard icon={Home} label="Imóveis indexados" value={metrics.listings.total} />
            <StatCard icon={Users} label="Usuários" value={metrics.users.total} />
            <StatCard icon={FileText} label="Briefings" value={metrics.briefings.total} />
          </div>

          {/* Distributions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Sync status */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold">Status de sincronização</h2>
              {['done', 'idle', 'running', 'error'].map((s) => (
                <DistBar
                  key={s}
                  label={s}
                  value={metrics.sites.byStatus[s] ?? 0}
                  total={Object.values(metrics.sites.byStatus).reduce((a, b) => a + b, 0)}
                  color={statusColor(s)}
                />
              ))}
            </div>

            {/* Users by plan */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold">Usuários por plano</h2>
              {PLAN_ORDER.map((p) => (
                <DistBar
                  key={p}
                  label={p}
                  value={metrics.users.byPlan[p] ?? 0}
                  total={metrics.users.total}
                  color={p === 'pro' ? 'bg-primary' : p === 'starter' ? 'bg-amber-500' : 'bg-muted-foreground'}
                />
              ))}
            </div>

            {/* Users by role */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold">Usuários por role</h2>
              {ROLE_ORDER.map((r) => (
                <DistBar
                  key={r}
                  label={r}
                  value={metrics.users.byRole[r] ?? 0}
                  total={metrics.users.total}
                  color={r === 'admin' ? 'bg-primary' : r === 'owner' ? 'bg-amber-500' : 'bg-muted-foreground'}
                />
              ))}
            </div>
          </div>

          {/* Top sites */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 bg-muted/40 border-b border-border">
              <h2 className="text-sm font-semibold">Top sites por imóveis</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">#</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Site</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Imóveis</th>
                  <th className="text-center px-4 py-2 font-medium text-muted-foreground text-xs">Status</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Último sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {metrics.sites.top.map((site, idx) => (
                  <tr key={site.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">{idx + 1}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{site.name}</p>
                      <p className="text-xs text-muted-foreground">{site.domain}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {site.listingCount.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${statusColor(site.syncStatus)}`} />
                      <span className="text-xs text-muted-foreground">{site.syncStatus}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                      {site.lastScrapedAt
                        ? new Date(site.lastScrapedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recent errors */}
          {metrics.sites.recentErrors.length > 0 && (
            <div className="rounded-lg border border-destructive/30 overflow-hidden">
              <div className="px-4 py-3 bg-destructive/5 border-b border-destructive/20 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                <h2 className="text-sm font-semibold text-destructive">Sites com erro</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b border-destructive/20">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Site</th>
                    <th className="text-center px-4 py-2 font-medium text-muted-foreground text-xs">Falhas consecutivas</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Último erro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-destructive/10">
                  {metrics.sites.recentErrors.map((site) => (
                    <tr key={site.id} className="hover:bg-destructive/5 transition-colors">
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{site.name}</p>
                        <p className="text-xs text-muted-foreground">{site.domain}</p>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="text-xs font-bold text-destructive">{site.consecutiveFailures}×</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                        {site.lastErrorAt
                          ? new Date(site.lastErrorAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

const PLAN_ORDER = ['free', 'starter', 'pro'] as const;
const ROLE_ORDER = ['broker', 'owner', 'admin'] as const;
