'use client';

import { useState } from 'react';
import { X, Copy, Check, Loader2, ExternalLink, Users, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PropertyCardData } from '@/components/search/PropertyCard';
import { apiFetch } from '@/lib/api-fetch';

type MessageTarget = 'client' | 'partner';

interface WhatsAppMessageModalProps {
  briefingId: string;
  selectedIds: string[];
  listings: PropertyCardData[];
  clientName?: string;
  clientProfile?: string; // summary of client's criteria, used in partner template
  onClose: () => void;
}

export function WhatsAppMessageModal({
  briefingId,
  selectedIds,
  listings,
  clientName,
  clientProfile: _clientProfile,
  onClose,
}: WhatsAppMessageModalProps) {
  const selectedListings = selectedIds
    .map((id) => listings.find((l) => l.id === id))
    .filter((l): l is PropertyCardData => l !== undefined);

  const [target, setTarget] = useState<MessageTarget>('client');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [formattedText, setFormattedText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateMessage() {
    setLoading(true);
    setError(null);
    try {
            const res = await apiFetch(`/api/v1/briefings/${briefingId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target,
          selectedProperties: selectedIds.map((id) => ({
            propertyId: id,
            personalNote: notes[id] ?? null,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: { userMessage?: string } })?.error?.userMessage ?? 'Erro ao gerar mensagem.');
      }
      const data = await res.json() as { data: { formattedText: string } };
      setFormattedText(data.data.formattedText);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido.');
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard() {
    if (!formattedText) return;
    try {
      await navigator.clipboard.writeText(formattedText);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = formattedText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function openInWhatsApp() {
    if (!formattedText) return;
    const encoded = encodeURIComponent(formattedText);
    window.open(`https://wa.me/?text=${encoded}`, '_blank', 'noopener,noreferrer');
  }

  function reset() {
    setFormattedText(null);
    setCopied(false);
    setError(null);
  }

  const targetLabel = target === 'client' ? 'cliente' : 'corretor parceiro';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-xl rounded-2xl bg-background shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-base font-semibold">
            Mensagem WhatsApp — {selectedIds.length} imóvel{selectedIds.length !== 1 ? 'is' : ''}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 hover:bg-muted text-muted-foreground"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {/* Target selector */}
          {!formattedText && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Mensagem para:</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTarget('client')}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                    target === 'client'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
                  }`}
                >
                  <User className="h-4 w-4 flex-shrink-0" />
                  <span>Cliente final</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTarget('partner')}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                    target === 'partner'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
                  }`}
                >
                  <Users className="h-4 w-4 flex-shrink-0" />
                  <span>Corretor parceiro</span>
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {target === 'client'
                  ? `Mensagem apresentando os imóveis ao ${clientName ?? 'seu cliente'}.`
                  : 'Proposta de parceria de venda conjunta para o corretor/imobiliária do imóvel.'}
              </p>
            </div>
          )}

          {/* Per-property notes — shown before generation */}
          {!formattedText && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {target === 'client'
                  ? 'Adicione uma nota personalizada para cada imóvel (opcional):'
                  : 'Adicione um comentário sobre cada imóvel (opcional):'}
              </p>
              {selectedListings.map((p) => (
                <div key={p.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium line-clamp-1 flex-1">
                      {p.title || `${p.neighborhood ?? ''}, ${p.city}`.trim()}
                    </p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {p.fitScore != null && (
                        <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-full ${
                          p.fitScore >= 80 ? 'bg-[#4FD66E]/10 text-[#4FD66E]' :
                          p.fitScore >= 60 ? 'bg-[#FF9F00]/10 text-[#FF9F00]' :
                          'bg-[#FF5E5E]/10 text-[#FF5E5E]'
                        }`}>
                          {Math.round(p.fitScore)}% match
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {p.price
                          ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(p.price)
                          : ''}
                      </span>
                    </div>
                  </div>
                  <textarea
                    rows={2}
                    maxLength={500}
                    placeholder={
                      target === 'client'
                        ? 'Ex: perfeito para quem quer sossego…'
                        : 'Ex: meu cliente tem urgência para fechar…'
                    }
                    className="w-full resize-none rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    value={notes[p.id] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Message preview */}
          {formattedText && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Prévia — mensagem para {targetLabel}:</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  target === 'client'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-secondary/10 text-secondary'
                }`}>
                  {target === 'client' ? '👤 Cliente' : '🤝 Parceiro'}
                </span>
              </div>
              <pre className="whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-4 text-sm font-sans leading-relaxed overflow-x-auto">
                {formattedText}
              </pre>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex gap-3 px-6 py-4 border-t border-border flex-shrink-0">
          {!formattedText ? (
            <>
              <Button variant="outline" onClick={onClose} className="flex-1">
                Cancelar
              </Button>
              <Button onClick={generateMessage} disabled={loading} className="flex-1 gap-2">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? 'Gerando…' : 'Gerar mensagem'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={reset} className="flex-shrink-0">
                Editar
              </Button>
              <Button
                variant="outline"
                onClick={copyToClipboard}
                className="flex-1 gap-2"
              >
                {copied ? (
                  <><Check className="h-4 w-4" /> Copiado!</>
                ) : (
                  <><Copy className="h-4 w-4" /> Copiar texto</>
                )}
              </Button>
              <Button onClick={openInWhatsApp} className="flex-1 gap-2">
                <ExternalLink className="h-4 w-4" />
                Abrir no WhatsApp
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
