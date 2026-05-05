import Link from 'next/link';
import { Plus, Clock, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyBriefingsState } from '@/components/briefings/BriefingForm';

export const metadata = { title: 'Briefings — PropMatch AI' };

const STATUS_CONFIG = {
  ready: { label: 'Pronto', icon: CheckCircle, className: 'text-success' },
  extracting: { label: 'Extraindo', icon: Loader, className: 'text-secondary animate-spin' },
  searching: { label: 'Buscando', icon: Loader, className: 'text-secondary animate-spin' },
  failed: { label: 'Falhou', icon: AlertCircle, className: 'text-danger' },
} as const;

async function fetchBriefings() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/v1/briefings?per_page=50`, {
    next: { revalidate: 10 },
  });
  if (!res.ok) return { items: [], total: 0 };
  return res.json() as Promise<{
    items: {
      id: string;
      rawText: string;
      status: keyof typeof STATUS_CONFIG;
      reviewStatus: string;
      extractionConfidence: number | null;
      createdAt: string;
    }[];
    total: number;
  }>;
}

export default async function BriefingsPage() {
  const { items, total } = await fetchBriefings();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Briefings</h2>
          <p className="text-muted-foreground mt-1">
            {total > 0 ? `${total} briefings encontrados` : 'Nenhum briefing ainda'}
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link href="/briefings/new">
            <Plus className="w-4 h-4" />
            Novo briefing
          </Link>
        </Button>
      </div>

      {items.length === 0 ? (
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
                {items.map((briefing, idx) => {
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
