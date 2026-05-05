'use client';

import { useState } from 'react';
import { FileText, Home, MessageCircle, TrendingUp, Clock, CheckCircle, Loader } from 'lucide-react';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { PropertyCard } from '@/components/dashboard/PropertyCard';
import { Badge } from '@/components/ui/badge';

const kpiData = [
  {
    title: 'Total Briefings',
    value: '683',
    delta: 12,
    deltaLabel: 'esta semana',
    icon: FileText,
    iconColor: 'primary' as const,
  },
  {
    title: 'Imóveis Encontrados',
    value: '2.847',
    delta: 8,
    deltaLabel: 'este mês',
    icon: Home,
    iconColor: 'secondary' as const,
  },
  {
    title: 'Mensagens Geradas',
    value: '1.203',
    delta: 5,
    deltaLabel: 'esta semana',
    icon: MessageCircle,
    iconColor: 'success' as const,
  },
  {
    title: 'Taxa de Conversão',
    value: '34%',
    delta: -2,
    deltaLabel: 'vs. mês anterior',
    icon: TrendingUp,
    iconColor: 'warning' as const,
  },
];

const recentBriefings = [
  {
    id: 1,
    client: 'Maria Silva',
    summary: '2 dorm, Vila Mariana, até R$ 850k, perto do metrô',
    results: 12,
    status: 'completed',
    time: '5 min atrás',
  },
  {
    id: 2,
    client: 'João Pereira',
    summary: 'Apartamento 3 dorm, Moema ou Ibirapuera, até 1,2M',
    results: 8,
    status: 'completed',
    time: '1 hora atrás',
  },
  {
    id: 3,
    client: 'Ana Costa',
    summary: 'Studio, Pinheiros, até R$ 500k, academia no condomínio',
    results: 0,
    status: 'processing',
    time: 'Agora',
  },
  {
    id: 4,
    client: 'Carlos Mendes',
    summary: '4 dorm, Jardins ou Higienópolis, 250m+, 2 vagas',
    results: 5,
    status: 'completed',
    time: '3 horas atrás',
  },
  {
    id: 5,
    client: 'Beatriz Ramos',
    summary: 'Casa 3 dorm, Morumbi, até R$ 1,5M, quintal obrigatório',
    results: 3,
    status: 'completed',
    time: 'Ontem',
  },
];

const featuredProperties = [
  {
    id: 1,
    address: 'Rua Domingos de Morais, 1234',
    neighborhood: 'Vila Mariana',
    city: 'São Paulo',
    price: 750000,
    bedrooms: 2,
    area: 68,
    fitScore: 92,
  },
  {
    id: 2,
    address: 'Av. Nove de Julho, 456',
    neighborhood: 'Jardim Paulista',
    city: 'São Paulo',
    price: 820000,
    bedrooms: 2,
    area: 72,
    fitScore: 78,
  },
  {
    id: 3,
    address: 'Rua Vergueiro, 2890',
    neighborhood: 'Paraíso',
    city: 'São Paulo',
    price: 695000,
    bedrooms: 2,
    area: 60,
    fitScore: 45,
  },
];

const statusConfig = {
  completed: { label: 'Concluído', icon: CheckCircle, className: 'text-success' },
  processing: { label: 'Processando', icon: Loader, className: 'text-secondary animate-spin' },
  pending: { label: 'Pendente', icon: Clock, className: 'text-muted-foreground' },
};

export default function DashboardPage() {
  const [selectedProperties, setSelectedProperties] = useState<Set<number>>(new Set());

  function toggleProperty(id: number) {
    setSelectedProperties((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
        <p className="text-muted-foreground mt-1">Bom dia, Diego</p>
      </div>

      {/* KPI grid */}
      <section aria-labelledby="kpi-heading">
        <h3 id="kpi-heading" className="sr-only">
          Métricas principais
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {kpiData.map((kpi) => (
            <KpiCard key={kpi.title} {...kpi} />
          ))}
        </div>
      </section>

      {/* Recent briefings */}
      <section aria-labelledby="briefings-heading">
        <div className="flex items-center justify-between mb-4">
          <h3 id="briefings-heading" className="text-lg font-semibold text-foreground">
            Briefings Recentes
          </h3>
          <a href="/briefings" className="text-sm text-primary font-medium hover:underline">
            Ver todos
          </a>
        </div>
        <div className="bg-card rounded-lg shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Cliente
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Resumo
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Resultados
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Status
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Hora
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentBriefings.map((briefing, idx) => {
                  const status = statusConfig[briefing.status as keyof typeof statusConfig];
                  const StatusIcon = status.icon;
                  return (
                    <tr
                      key={briefing.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${idx % 2 === 0 ? '' : 'bg-muted/10'}`}
                    >
                      <td className="px-6 py-4 font-medium text-foreground whitespace-nowrap">
                        {briefing.client}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground max-w-xs truncate">
                        {briefing.summary}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge
                          variant="secondary"
                          className="bg-primary/10 text-primary hover:bg-primary/10"
                        >
                          {briefing.results} imóveis
                        </Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`flex items-center gap-1.5 font-medium ${status.className}`}>
                          <StatusIcon className="w-4 h-4" />
                          {status.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                        {briefing.time}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Featured properties */}
      <section aria-labelledby="properties-heading">
        <div className="flex items-center justify-between mb-4">
          <h3 id="properties-heading" className="text-lg font-semibold text-foreground">
            Imóveis em Destaque
          </h3>
          <a href="/historico" className="text-sm text-primary font-medium hover:underline">
            Ver histórico
          </a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {featuredProperties.map((property) => (
            <PropertyCard
              key={property.id}
              address={property.address}
              neighborhood={property.neighborhood}
              city={property.city}
              price={property.price}
              bedrooms={property.bedrooms}
              area={property.area}
              fitScore={property.fitScore}
              selected={selectedProperties.has(property.id)}
              onSelect={() => toggleProperty(property.id)}
              onViewSource={() => {}}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
