'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, Loader, CheckCircle, AlertCircle, ArrowRight, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { apiFetch } from '@/lib/api-fetch';
import { toastError } from '@/lib/toast';

const STATUS_CONFIG = {
  ready: { label: 'Pronto para revisar', icon: CheckCircle, className: 'text-success', bg: 'bg-success/10' },
  extracting: { label: 'Extraindo critérios…', icon: Loader, className: 'text-secondary animate-spin', bg: 'bg-secondary/10' },
  searching: { label: 'Buscando imóveis…', icon: Loader, className: 'text-primary animate-spin', bg: 'bg-primary/10' },
  failed: { label: 'Falhou', icon: AlertCircle, className: 'text-danger', bg: 'bg-danger/10' },
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
  const [active, setActive] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/v1/briefings?per_page=50')
      .then((r) => r.json())
      .then((d: { items?: Briefing[]; error?: unknown }) => {
        if (d.error) {
          toastError('Não foi possível carregar os briefings.');
        } else {
          setActive(
            (d.items ?? []).filter(
              (b) => b.status === 'extracting' || b.status === 'searching' || b.status === 'ready',
            ),
          );
        }
      })
      .catch(() => toastError('Erro ao conectar com o servidor.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Briefings</h2>
        <p className="text-muted-foreground mt-1">Buscas em andamento e prontas para revisão.</p>
      </div>

      {/* Quick action */}
      <div className="bg-card rounded-xl shadow-card p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-1">
          <h3 className="font-semibold text-foreground">Iniciar nova busca</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Cole o briefing do cliente e deixe a IA extrair os critérios automaticamente.
          </p>
        </div>
        <Button asChild className="gap-2 shrink-0">
          <Link href="/busca">
            <Search className="w-4 h-4" />
            Nova busca
          </Link>
        </Button>
      </div>

      {/* Active briefings */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Em andamento</h3>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 skeleton rounded-xl" />
            ))}
          </div>
        ) : active.length === 0 ? (
          <div className="bg-card rounded-xl shadow-card">
            <EmptyState
              icon={ScanSearch}
              title="Nenhuma busca ativa"
              description="Todas as buscas foram concluídas. Inicie uma nova ou consulte o histórico."
              action={
                <Button variant="outline" asChild size="sm">
                  <Link href="/historico">Ver histórico completo</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <div className="space-y-3">
            {active.map((briefing, i) => {
              const cfg = STATUS_CONFIG[briefing.status] ?? STATUS_CONFIG.failed;
              const Icon = cfg.icon;
              return (
                <Link
                  key={briefing.id}
                  href={`/briefings/${briefing.id}`}
                  className="bg-card rounded-xl shadow-card p-4 flex items-center gap-4 hover:bg-muted/30 transition-colors group animate-fade-in-up card-hover block"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className={`w-9 h-9 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4 h-4 ${cfg.className}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground line-clamp-1">{briefing.rawText}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{cfg.label}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                </Link>
              );
            })}
          </div>
        )}

        {active.length > 0 && (
          <div className="pt-1">
            <Link href="/historico" className="text-sm text-primary hover:underline">
              Ver histórico completo →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
