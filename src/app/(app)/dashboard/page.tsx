'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Home, MessageCircle, Users, CheckCircle, Loader, Clock, MapPin, BarChart2 } from 'lucide-react';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { CLIENT_CRM_STATUS_LABELS, CLIENT_CRM_STATUS_COLORS } from '@/lib/schemas/client';
import { apiFetch } from '@/lib/api-fetch';

interface WeekPoint { week: string; briefings: number }
interface Neighborhood { name: string; count: number }
interface RecentBriefing {
  id: string;
  status: string;
  createdAt: string;
  client: { id: string; name: string; isGuest: boolean } | null;
  _count: { results: number };
}
interface Analytics {
  kpis: {
    totalBriefings: number;
    briefingsThisWeek: number;
    totalResults: number;
    resultsThisMonth: number;
    totalMessages: number;
    messagesThisWeek: number;
    clientsActive: number;
  };
  crmDistribution: Record<string, number>;
  weeklyHistory: WeekPoint[];
  topNeighborhoods: Neighborhood[];
  recentActivity: RecentBriefing[];
}


const statusConfig = {
  done: { label: 'Concluído', icon: CheckCircle, cls: 'text-[#4FD66E]' },
  processing: { label: 'Processando', icon: Loader, cls: 'text-primary animate-spin' },
  extracting: { label: 'Extraindo', icon: Loader, cls: 'text-primary animate-spin' },
  pending: { label: 'Pendente', icon: Clock, cls: 'text-muted-foreground' },
  failed: { label: 'Falhou', icon: Clock, cls: 'text-destructive' },
} as const;

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Agora';
  if (min < 60) return `${min} min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

export default function DashboardPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/v1/analytics/summary')
      .then((r) => r.json())
      .then((d: Analytics & { error?: unknown }) => setAnalytics(d.error ? null : d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-skeleton rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-48 bg-skeleton rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="space-y-8">
        <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
        <p className="text-muted-foreground">Erro ao carregar dados.</p>
      </div>
    );
  }

  const { kpis, crmDistribution, weeklyHistory, topNeighborhoods, recentActivity } = analytics;
  const totalCrm = Object.values(crmDistribution).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
        <p className="text-muted-foreground mt-1">Resumo da sua carteira</p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <KpiCard
          title="Briefings"
          value={kpis.totalBriefings.toLocaleString('pt-BR')}
          delta={kpis.briefingsThisWeek}
          deltaLabel="esta semana"
          icon={FileText}
          iconColor="primary"
        />
        <KpiCard
          title="Imóveis encontrados"
          value={kpis.totalResults.toLocaleString('pt-BR')}
          delta={kpis.resultsThisMonth}
          deltaLabel="este mês"
          icon={Home}
          iconColor="secondary"
        />
        <KpiCard
          title="Mensagens geradas"
          value={kpis.totalMessages.toLocaleString('pt-BR')}
          delta={kpis.messagesThisWeek}
          deltaLabel="esta semana"
          icon={MessageCircle}
          iconColor="success"
        />
        <KpiCard
          title="Clientes ativos"
          value={kpis.clientsActive.toLocaleString('pt-BR')}
          delta={0}
          deltaLabel="salvos"
          icon={Users}
          iconColor="warning"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Briefings recentes */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Briefings recentes</h3>
            <Link href="/historico" className="text-xs text-primary hover:underline">Ver todos</Link>
          </div>
          {recentActivity.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhum briefing ainda. <Link href="/busca" className="text-primary hover:underline">Criar primeiro</Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentActivity.map((b) => {
                const st = statusConfig[b.status as keyof typeof statusConfig] ?? statusConfig.pending;
                const Icon = st.icon;
                return (
                  <Link
                    key={b.id}
                    href={`/briefings/${b.id}`}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/40 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {b.client?.name ?? 'Cliente guest'}
                        {b.client?.isGuest && (
                          <span className="ml-1.5 text-xs text-muted-foreground font-normal">(guest)</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(b.createdAt)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-foreground">{b._count.results}</p>
                      <p className="text-[10px] text-muted-foreground">imóveis</p>
                    </div>
                    <span className={`shrink-0 flex items-center gap-1 text-xs font-medium ${st.cls}`}>
                      <Icon className="w-3.5 h-3.5" />
                      {st.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Painel lateral */}
        <div className="space-y-6">

          {/* Pipeline CRM */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <BarChart2 className="w-4 h-4" />
              Pipeline CRM
            </h3>
            {Object.keys(CLIENT_CRM_STATUS_LABELS).map((status) => {
              const count = crmDistribution[status] ?? 0;
              const pct = Math.round((count / totalCrm) * 100);
              return (
                <div key={status}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={`px-2 py-0.5 rounded-full font-medium ${CLIENT_CRM_STATUS_COLORS[status as keyof typeof CLIENT_CRM_STATUS_COLORS]}`}>
                      {CLIENT_CRM_STATUS_LABELS[status as keyof typeof CLIENT_CRM_STATUS_LABELS]}
                    </span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {kpis.clientsActive === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum cliente salvo ainda.</p>
            )}
          </div>

          {/* Top bairros */}
          {topNeighborhoods.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Bairros mais buscados
              </h3>
              {topNeighborhoods.map((n, i) => (
                <div key={n.name} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-xs text-muted-foreground font-mono">{i + 1}</span>
                  <span className="flex-1 text-foreground truncate">{n.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{n.count}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Sparkline — histórico de briefings */}
      {weeklyHistory.some((w) => w.briefings > 0) && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Briefings — últimas 12 semanas</h3>
            <span className="text-xs text-muted-foreground">
              Total: {weeklyHistory.reduce((a, w) => a + w.briefings, 0)}
            </span>
          </div>
          <div className="flex items-end justify-between gap-1 h-16">
            {weeklyHistory.map((w, i) => {
              const max = Math.max(...weeklyHistory.map((x) => x.briefings), 1);
              const pct = (w.briefings / max) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                  <div
                    className="w-full rounded-sm bg-primary/20 group-hover:bg-primary/40 transition-colors"
                    style={{ height: `${Math.max(pct, 4)}%`, minHeight: '4px' }}
                    title={`${w.week}: ${w.briefings} briefing${w.briefings !== 1 ? 's' : ''}`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-2">
            <span>{weeklyHistory[0]?.week?.slice(0, 7)}</span>
            <span>{weeklyHistory[11]?.week?.slice(0, 7)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
