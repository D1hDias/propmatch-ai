'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  ChevronLeft,
  Edit2,
  FileText,
  Globe,
  Loader,
  Mail,
  MapPin,
  Phone,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CLIENT_CRM_STATUS_LABELS,
  CLIENT_CRM_STATUS_COLORS,
  CLIENT_URGENCY_LABELS,
  type ClientProfile,
} from '@/lib/schemas/client';

interface ScanEntry {
  briefingId: string;
  status: string;
  createdAt: string;
  totalResults: number;
  aboveThreshold: number;
  selectedPortals: string[];
  customUrlCount: number;
}

interface ClientDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isGuest: boolean;
  archiveStatus: 'active' | 'soft_archived' | 'pending_delete';
  crmStatus: 'ativo' | 'negociacao' | 'fechado' | 'pausado';
  urgency: 'ativo' | 'prazo' | 'explorando';
  matchThreshold: number;
  profile: ClientProfile | null;
  createdAt: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(v: number | null | undefined) {
  if (v == null) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);
}

function ProfileSection({ profile }: { profile: ClientProfile }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <span className="text-muted-foreground">Objetivo:</span>{' '}
          <span className="font-medium">{profile.purpose === 'buy' ? 'Compra' : 'Aluguel'}</span>
        </div>
        {profile.motivation && (
          <div>
            <span className="text-muted-foreground">Motivação:</span>{' '}
            <span className="font-medium capitalize">{profile.motivation}</span>
          </div>
        )}
        {profile.paymentMethod && (
          <div>
            <span className="text-muted-foreground">Pagamento:</span>{' '}
            <span className="font-medium">
              {{ cash: 'À vista', financing: 'Financiamento', fgts: 'FGTS', mixed: 'Misto' }[profile.paymentMethod]}
            </span>
          </div>
        )}
        {profile.deadline && (
          <div>
            <span className="text-muted-foreground">Prazo:</span>{' '}
            <span className="font-medium">{formatDate(profile.deadline)}</span>
          </div>
        )}
      </div>

      {profile.neighborhoods.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Bairros</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.neighborhoods.map((n) => (
              <span key={n} className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">{n}</span>
            ))}
          </div>
        </div>
      )}

      {profile.propertyTypes.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Tipos</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.propertyTypes.map((t) => (
              <span key={t} className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground">{t}</span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
        {(profile.bedroomsMin != null || profile.bedroomsMax != null) && (
          <div>
            <span className="text-muted-foreground">Quartos:</span>{' '}
            <span className="font-medium">
              {profile.bedroomsMin ?? '—'} – {profile.bedroomsMax ?? '—'}
            </span>
          </div>
        )}
        {(profile.priceMin != null || profile.priceMax != null) && (
          <div>
            <span className="text-muted-foreground">Preço:</span>{' '}
            <span className="font-medium">
              {formatCurrency(profile.priceMin) ?? '—'} – {formatCurrency(profile.priceMax) ?? '—'}
            </span>
            {profile.budgetFlexibility > 0 && (
              <span className="text-muted-foreground ml-1">(+{profile.budgetFlexibility}% flex.)</span>
            )}
          </div>
        )}
        {profile.areaMin != null && (
          <div>
            <span className="text-muted-foreground">Área mín.:</span>{' '}
            <span className="font-medium">{profile.areaMin} m²</span>
          </div>
        )}
      </div>

      {profile.mustHaves.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Indispensáveis</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.mustHaves.map((t) => (
              <span key={t} className="text-xs px-2.5 py-1 rounded-full bg-[#4FD66E]/10 text-[#4FD66E] font-medium">{t}</span>
            ))}
          </div>
        </div>
      )}

      {profile.niceToHaves.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Desejáveis</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.niceToHaves.map((t) => (
              <span key={t} className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground">{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const token = sessionStorage.getItem('access_token');
    const res = await fetch(`/api/v1/clients/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { setError('Cliente não encontrado.'); setLoading(false); return; }
    const data = (await res.json()) as { client?: ClientDetail; scanHistory?: ScanEntry[] };
    setClient(data.client ?? null);
    setScanHistory(data.scanHistory ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleArchive() {
    if (!client) return;
    setArchiving(true);
    const token = sessionStorage.getItem('access_token');
    if (client.archiveStatus === 'active') {
      await fetch(`/api/v1/clients/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } else {
      await fetch(`/api/v1/clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ archiveStatus: 'active' }),
      });
    }
    await load();
    setArchiving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
        <p className="text-muted-foreground">{error || 'Cliente não encontrado.'}</p>
        <Button variant="outline" onClick={() => router.push('/clients')}>Voltar</Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/clients')} className="text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-foreground">{client.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CLIENT_CRM_STATUS_COLORS[client.crmStatus]}`}>
                {CLIENT_CRM_STATUS_LABELS[client.crmStatus]}
              </span>
              {client.archiveStatus !== 'active' && (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  arquivado
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {CLIENT_URGENCY_LABELS[client.urgency]} · desde {formatDate(client.createdAt)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href={`/clients/${id}/edit`}>
              <Edit2 className="w-3.5 h-3.5" />
              Editar
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleArchive}
            disabled={archiving}
            className="gap-1.5"
          >
            {archiving
              ? <Loader className="w-3.5 h-3.5 animate-spin" />
              : client.archiveStatus === 'active'
              ? <Archive className="w-3.5 h-3.5" />
              : <ArchiveRestore className="w-3.5 h-3.5" />
            }
            {client.archiveStatus === 'active' ? 'Arquivar' : 'Restaurar'}
          </Button>
        </div>
      </div>

      {/* Contato */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Contato</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          {client.phone && (
            <a href={`tel:${client.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
              <Phone className="w-4 h-4" />
              {client.phone}
            </a>
          )}
          {client.email && (
            <a href={`mailto:${client.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
              <Mail className="w-4 h-4" />
              {client.email}
            </a>
          )}
          {!client.phone && !client.email && (
            <p className="text-muted-foreground">Sem dados de contato.</p>
          )}
        </div>
        {client.notes && (
          <p className="text-sm text-muted-foreground border-t border-border pt-3 mt-3">{client.notes}</p>
        )}
      </div>

      {/* Match threshold */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Threshold de match</h2>
          </div>
          <span className="text-lg font-bold text-primary">{client.matchThreshold}%</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${client.matchThreshold}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Somente resultados com score ≥ {client.matchThreshold}% aparecem nas varreduras desta pasta.
        </p>
      </div>

      {/* Perfil de busca */}
      {client.profile && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Perfil de busca</h2>
          <ProfileSection profile={client.profile} />
        </div>
      )}

      {/* Histórico de varreduras */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Histórico de varreduras
          </h2>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link href={`/briefings?client_id=${id}`}>
              Ver todos
            </Link>
          </Button>
        </div>

        {scanHistory.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma varredura realizada ainda.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {scanHistory.map((scan) => (
              <Link
                key={scan.briefingId}
                href={`/briefings/${scan.briefingId}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/40 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                    <span>{formatDate(scan.createdAt)}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-medium ${
                        scan.status === 'done'
                          ? 'bg-[#4FD66E]/10 text-[#4FD66E]'
                          : scan.status === 'processing'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {scan.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {scan.selectedPortals.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Globe className="w-3 h-3" />
                        {scan.selectedPortals.join(', ')}
                      </span>
                    )}
                    {scan.customUrlCount > 0 && (
                      <span>+{scan.customUrlCount} URL{scan.customUrlCount > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {scan.aboveThreshold}
                    <span className="text-xs font-normal text-muted-foreground"> / {scan.totalResults}</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">acima do threshold</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
