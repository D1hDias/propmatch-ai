'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { Plus, CheckCircle, AlertCircle, Loader, FileText, ChevronDown, ChevronUp, ExternalLink, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { apiFetch } from '@/lib/api-fetch';
import { toastError } from '@/lib/toast';

const STATUS_CONFIG = {
  ready: { label: 'Pronto', icon: CheckCircle, className: 'text-success' },
  extracting: { label: 'Extraindo', icon: Loader, className: 'text-secondary animate-spin' },
  searching: { label: 'Buscando', icon: Loader, className: 'text-secondary animate-spin' },
  failed: { label: 'Falhou', icon: AlertCircle, className: 'text-danger' },
} as const;

type Briefing = {
  id: string;
  rawText: string;
  status: keyof typeof STATUS_CONFIG;
  reviewStatus: string;
  extractionConfidence: number | null;
  createdAt: string;
  clientId: string;
};

type ExtractedCriteria = {
  purpose?: 'sale' | 'rent';
  property_types?: string[];
  neighborhoods?: string[];
  city?: string;
  price_min?: number | null;
  price_max?: number | null;
  bedrooms_min?: number | null;
  parking_min?: number | null;
  area_min?: number | null;
  area_max?: number | null;
};

type BriefingDetail = {
  id: string;
  rawText: string;
  extractedCriteria: ExtractedCriteria | null;
  clientId: string;
};

function buildBuscaUrl(criteria: ExtractedCriteria, clientId?: string): string {
  const params = new URLSearchParams();
  if (criteria.purpose) params.set('purpose', criteria.purpose);
  if (criteria.property_types?.length) params.set('propertyType', criteria.property_types[0]!);
  if (criteria.neighborhoods?.length) params.set('neighborhoods', criteria.neighborhoods.join(','));
  if (criteria.price_min != null) params.set('priceMin', String(criteria.price_min));
  if (criteria.price_max != null) params.set('priceMax', String(criteria.price_max));
  if (criteria.bedrooms_min != null) params.set('bedroomsMin', String(criteria.bedrooms_min));
  if (criteria.parking_min != null) params.set('parkingMin', String(criteria.parking_min));
  if (criteria.area_min != null) params.set('areaMin', String(criteria.area_min));
  if (criteria.area_max != null) params.set('areaMax', String(criteria.area_max));
  if (clientId) params.set('clientId', clientId);
  const qs = params.toString();
  return qs ? `/busca?${qs}` : '/busca';
}

function criteriaLabels(c: ExtractedCriteria): string[] {
  const labels: string[] = [];
  if (c.purpose === 'sale') labels.push('Venda');
  else if (c.purpose === 'rent') labels.push('Aluguel');
  if (c.neighborhoods?.length) labels.push(...c.neighborhoods.slice(0, 4));
  if (c.bedrooms_min != null) labels.push(`${c.bedrooms_min}+ quartos`);
  if (c.price_max != null) {
    const v = c.price_max >= 1_000_000
      ? `≤ R$${(c.price_max / 1_000_000).toFixed(1)}M`
      : `≤ R$${(c.price_max / 1_000).toFixed(0)}k`;
    labels.push(v);
  }
  return labels;
}

export default function HistoricoPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, BriefingDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/api/v1/briefings?per_page=50')
      .then((r) => r.json())
      .then((d: { items?: Briefing[]; total?: number; error?: unknown }) => {
        if (d.error) {
          toastError('Não foi possível carregar o histórico. Tente novamente.');
        } else {
          setBriefings(d.items ?? []);
          setTotal(d.total ?? 0);
        }
      })
      .catch(() => toastError('Erro ao conectar com o servidor.'))
      .finally(() => setLoading(false));
  }, []);

  const handleRowClick = useCallback(async (briefing: Briefing) => {
    if (expandedId === briefing.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(briefing.id);
    if (detailCache[briefing.id]) return;
    setDetailLoading(briefing.id);
    try {
      const r = await apiFetch(`/api/v1/briefings/${briefing.id}`);
      const d: BriefingDetail & { error?: unknown } = await r.json();
      if (!d.error) {
        setDetailCache((prev) => ({ ...prev, [briefing.id]: d }));
      }
    } catch {
      // silently degrade — rawText from list is still shown
    } finally {
      setDetailLoading(null);
    }
  }, [expandedId, detailCache]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Histórico</h2>
          <p className="text-muted-foreground mt-1">
            {loading ? 'Carregando…' : total > 0 ? `${total} buscas realizadas` : 'Nenhuma busca ainda'}
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link href="/busca">
            <Plus className="w-4 h-4" />
            Nova busca
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 skeleton rounded-xl" />
          ))}
        </div>
      ) : briefings.length === 0 ? (
        <div className="bg-card rounded-xl shadow-card">
          <EmptyState
            icon={FileText}
            title="Nenhuma busca ainda"
            description="Preencha os critérios do cliente para começar a usar o PropMatch AI."
            action={
              <Button asChild className="gap-2">
                <Link href="/busca">
                  <Plus className="w-4 h-4" />
                  Nova busca
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="bg-card rounded-xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Briefing
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
                    Confiança
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Status
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                    Data
                  </th>
                </tr>
              </thead>
              <tbody>
                {briefings.map((briefing, idx) => {
                  const cfg = STATUS_CONFIG[briefing.status] ?? STATUS_CONFIG.failed;
                  const Icon = cfg.icon;
                  const confidence = briefing.extractionConfidence;
                  const isExpanded = expandedId === briefing.id;
                  const detail = detailCache[briefing.id] ?? null;
                  const isLoadingDetail = detailLoading === briefing.id;
                  const criteria = detail?.extractedCriteria;
                  const labels = criteria ? criteriaLabels(criteria) : [];

                  return (
                    <Fragment key={briefing.id}>
                      <tr
                        onClick={() => handleRowClick(briefing)}
                        className={`border-b border-border transition-colors cursor-pointer animate-fade-in-up select-none ${
                          isExpanded ? 'bg-muted/40 border-primary/30' : 'hover:bg-muted/30 last:border-0'
                        }`}
                        style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground line-clamp-2 max-w-xs">{briefing.rawText}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                          {confidence != null ? (
                            <Badge
                              variant="secondary"
                              className={
                                confidence >= 0.85
                                  ? 'bg-success/10 text-success hover:bg-success/10'
                                  : confidence >= 0.8
                                    ? 'bg-warning/10 text-warning hover:bg-warning/10'
                                    : 'bg-danger/10 text-danger hover:bg-danger/10'
                              }
                            >
                              {Math.round(Number(confidence) * 100)}%
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`flex items-center gap-1.5 font-medium ${cfg.className}`}>
                            <Icon className="w-4 h-4" />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 hidden md:table-cell">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground whitespace-nowrap">
                              {new Date(briefing.createdAt).toLocaleDateString('pt-BR')}
                            </span>
                            {isExpanded
                              ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                              : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                            }
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="border-b border-primary/20 bg-primary/5">
                          <td colSpan={4} className="px-6 py-4">
                            {isLoadingDetail ? (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                                <Loader className="w-4 h-4 animate-spin" />
                                Carregando critérios…
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {/* Briefing original */}
                                <p className="text-sm italic text-muted-foreground bg-background/60 rounded-lg px-3 py-2 border border-border/50">
                                  "{briefing.rawText}"
                                </p>

                                {/* Critérios extraídos */}
                                {labels.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {labels.map((label) => (
                                      <span
                                        key={label}
                                        className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full font-medium"
                                      >
                                        {label}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {/* Ações */}
                                <div className="flex items-center gap-2 pt-1">
                                  <Button
                                    asChild
                                    size="sm"
                                    className="gap-1.5 h-8 text-xs"
                                  >
                                    <Link
                                      href={criteria ? buildBuscaUrl(criteria, briefing.clientId) : '/busca'}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                      Usar como base
                                    </Link>
                                  </Button>
                                  <Button
                                    asChild
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5 h-8 text-xs"
                                  >
                                    <Link
                                      href={`/briefings/${briefing.id}`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                      Ver busca completa
                                    </Link>
                                  </Button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
