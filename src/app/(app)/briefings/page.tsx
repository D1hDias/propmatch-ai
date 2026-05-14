'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyBriefingsState } from '@/components/briefings/BriefingForm';
import { apiFetch } from '@/lib/api-fetch';

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
};

export default function BriefingsPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/v1/briefings?per_page=50')
      .then((r) => r.json())
      .then((d: { items?: Briefing[]; total?: number; error?: unknown }) => {
        if (!d.error) {
          setBriefings(d.items ?? []);
          setTotal(d.total ?? 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Briefings</h2>
          <p className="text-muted-foreground mt-1">
            {loading ? 'Carregando…' : total > 0 ? `${total} briefings encontrados` : 'Nenhum briefing ainda'}
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link href="/briefings/new">
            <Plus className="w-4 h-4" />
            Novo briefing
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : briefings.length === 0 ? (
        <EmptyBriefingsState />
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
                  return (
                    <tr
                      key={briefing.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${idx % 2 !== 0 ? 'bg-muted/10' : ''}`}
                    >
                      <td className="px-6 py-4">
                        <Link
                          href={`/briefings/${briefing.id}`}
                          className="font-medium text-foreground hover:text-primary transition-colors line-clamp-2 max-w-xs block"
                        >
                          {briefing.rawText}
                        </Link>
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
                            {Math.round(confidence * 100)}%
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
                      <td className="px-6 py-4 text-muted-foreground whitespace-nowrap hidden md:table-cell">
                        {new Date(briefing.createdAt).toLocaleDateString('pt-BR')}
                      </td>
                    </tr>
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
