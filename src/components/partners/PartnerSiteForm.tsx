'use client';

import { useState } from 'react';
import { Plus, Loader, Globe, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-fetch';

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
  onCreated: (site: PartnerSite) => void;
}

export function PartnerSiteForm({ onCreated }: Props) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showForm, setShowForm] = useState(false);

  async function handleAdd() {
    const trimmedUrl = url.trim();
    const trimmedName = name.trim();
    if (!trimmedUrl || !trimmedName) return;

    try { new URL(trimmedUrl.startsWith('http') ? trimmedUrl : `https://${trimmedUrl}`); }
    catch { setError('URL inválida.'); return; }

    setSubmitting(true);
    setError('');
    setInfo('');

    try {
      const res = await apiFetch('/api/v1/partner-sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: trimmedUrl.startsWith('http') ? trimmedUrl : `https://${trimmedUrl}`,
          name: trimmedName,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: { user_message?: string } };
        throw new Error(data.error?.user_message ?? 'Erro ao adicionar site.');
      }

      const body = (await res.json()) as { data: PartnerSite; created: boolean };

      setUrl('');
      setName('');

      if (body.created) {
        // New site — add to list, trigger discovery in background, close form.
        onCreated(body.data);
        apiFetch(`/api/v1/partner-sites/${body.data.id}/discover`, { method: 'POST' }).catch(() => {});
        setShowForm(false);
      } else {
        // Site already existed in the platform — it's already in the list, don't add again.
        setInfo(`"${body.data.name}" já estava na plataforma e já está disponível para busca.`);
        setTimeout(() => { setInfo(''); setShowForm(false); }, 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="flex items-center gap-1.5 text-xs text-primary hover:underline"
      >
        <Plus className="w-3.5 h-3.5" />
        Adicionar site parceiro
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
      <p className="text-xs font-semibold text-foreground">Novo site parceiro</p>
      <input
        type="text"
        placeholder="URL do site (ex: https://imobiliaria.com.br)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <input
        type="text"
        placeholder="Nome do site (ex: Imobiliária Exemplo)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      {info && (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {info}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={submitting || !url.trim() || !name.trim()}
          className="gap-1.5"
        >
          {submitting ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
          Adicionar e descobrir
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setError(''); setInfo(''); }}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
