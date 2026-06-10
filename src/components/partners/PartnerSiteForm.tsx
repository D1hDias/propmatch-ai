'use client';

import { useState, useRef } from 'react';
import { Plus, Loader, Globe, CheckCircle, AlertTriangle } from 'lucide-react';
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

type ProbeStatus = 'idle' | 'checking' | 'ok' | 'unreachable';

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
}

function isValidUrlFormat(raw: string): boolean {
  try { new URL(normalizeUrl(raw)); return true; }
  catch { return false; }
}

export function PartnerSiteForm({ onCreated }: Props) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>('idle');
  // Tracks the URL that was last probed to skip duplicate probes on submit.
  const probedUrlRef = useRef<string>('');

  async function runProbe(rawUrl: string): Promise<boolean> {
    const normalized = normalizeUrl(rawUrl);
    probedUrlRef.current = normalized;
    setProbeStatus('checking');
    try {
      const res = await apiFetch('/api/v1/partner-sites/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized }),
      });
      // Ignore stale result if URL changed while probe was in flight.
      if (probedUrlRef.current !== normalized) return false;
      if (!res.ok) { setProbeStatus('idle'); return false; }
      const data = (await res.json()) as { data: { reachable: boolean } };
      const reachable = data.data.reachable;
      setProbeStatus(reachable ? 'ok' : 'unreachable');
      return reachable;
    } catch {
      if (probedUrlRef.current === normalized) setProbeStatus('idle');
      return false;
    }
  }

  function handleUrlChange(value: string) {
    setUrl(value);
    // Reset probe state whenever the URL changes so the user must re-validate.
    if (probeStatus !== 'idle') {
      setProbeStatus('idle');
      probedUrlRef.current = '';
    }
  }

  function handleUrlBlur() {
    if (!url.trim() || !isValidUrlFormat(url)) return;
    // Skip if we already have a result for this exact URL.
    if (normalizeUrl(url) === probedUrlRef.current && probeStatus !== 'idle') return;
    void runProbe(url);
  }

  async function handleAdd() {
    const trimmedUrl = url.trim();
    const trimmedName = name.trim();
    if (!trimmedUrl || !trimmedName) return;
    if (!isValidUrlFormat(trimmedUrl)) { setError('URL inválida.'); return; }

    setError('');
    setInfo('');

    // Run probe if not already verified for the current URL.
    if (probeStatus !== 'ok') {
      setSubmitting(true);
      const reachable = await runProbe(trimmedUrl);
      if (!reachable) {
        setError('Site não encontrado. Verifique se o endereço está correto (ex: .com.br em vez de .com).');
        setSubmitting(false);
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/v1/partner-sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizeUrl(trimmedUrl), name: trimmedName }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: { user_message?: string } };
        throw new Error(data.error?.user_message ?? 'Erro ao adicionar site.');
      }

      const body = (await res.json()) as { data: PartnerSite; created: boolean };

      setUrl('');
      setName('');
      setProbeStatus('idle');
      probedUrlRef.current = '';

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
      <div className="space-y-1">
        <input
          type="text"
          placeholder="URL do site (ex: https://imobiliaria.com.br)"
          value={url}
          onChange={(e) => handleUrlChange(e.target.value)}
          onBlur={handleUrlBlur}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {/* Probe status indicator */}
        {probeStatus === 'checking' && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader className="w-3 h-3 animate-spin flex-shrink-0" />
            Verificando se o site existe…
          </p>
        )}
        {probeStatus === 'ok' && (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle className="w-3 h-3 flex-shrink-0" />
            Site encontrado
          </p>
        )}
        {probeStatus === 'unreachable' && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            Site não encontrado. Verifique o endereço (ex: .com.br em vez de .com).
          </p>
        )}
      </div>
      <input
        type="text"
        placeholder="Nome do site (ex: Imobiliária Exemplo)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
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
          disabled={submitting || !url.trim() || !name.trim() || probeStatus === 'checking' || probeStatus === 'unreachable'}
          className="gap-1.5"
        >
          {submitting ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
          Adicionar e descobrir
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setError(''); setInfo(''); setProbeStatus('idle'); }}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
