'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ClientSelector } from '@/components/clients/ClientSelector';
import { Loader, Send, FileText } from 'lucide-react';

const MIN_CHARS = 10;
const MAX_CHARS = 2000;

const EXAMPLES = [
  'Cliente quer apto 2 dorm em Vila Mariana ou Moema, até R$ 850k, perto do metrô',
  'Família com cachorro procura casa 3 dorm no Morumbi, quintal obrigatório, até 1,5M',
  'Studio para investimento em Pinheiros, até R$ 500k, academia no condomínio',
];

export function BriefingForm() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const charCount = text.length;
  const isValid = charCount >= MIN_CHARS && charCount <= MAX_CHARS;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/v1/briefings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: text, ...(clientId ? { client_id: clientId } : {}) }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: { user_message?: string } };
        throw new Error(data.error?.user_message ?? 'Erro ao enviar briefing.');
      }

      const data = (await res.json()) as { id: string };
      router.push(`/briefings/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado. Tente novamente.');
      setSubmitting(false);
    }
  }

  function applyExample(example: string) {
    setText(example);
    textareaRef.current?.focus();
  }

  const counterColor =
    charCount > MAX_CHARS
      ? 'text-danger'
      : charCount > MAX_CHARS * 0.9
        ? 'text-warning'
        : 'text-muted-foreground';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Client selector — FE-9 */}
      <ClientSelector value={clientId} onChange={setClientId} disabled={submitting} />

      {/* Textarea */}
      <div className="space-y-2">
        <label
          htmlFor="briefing-text"
          className="block text-sm font-semibold text-foreground"
        >
          Mensagem do cliente
        </label>
        <p className="text-sm text-muted-foreground">
          Cole ou digite a mensagem livre do cliente. Pode incluir gírias, abreviações e emojis —
          a IA entende tudo em português brasileiro.
        </p>
        <div className="relative">
          <textarea
            id="briefing-text"
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ex: cliente quer apto 2 dorm Vila Mariana até 850k perto do metrô 🚇"
            rows={8}
            maxLength={MAX_CHARS + 50}
            className="briefing-input resize-none"
            aria-describedby="char-counter briefing-error"
            disabled={submitting}
          />
        </div>
        <div className="flex justify-between items-center">
          <span id="char-counter" className={`text-xs font-medium ${counterColor}`}>
            {charCount.toLocaleString('pt-BR')} / {MAX_CHARS.toLocaleString('pt-BR')} caracteres
          </span>
          {charCount < MIN_CHARS && charCount > 0 && (
            <span className="text-xs text-muted-foreground">
              Mínimo {MIN_CHARS} caracteres
            </span>
          )}
        </div>
      </div>

      {/* Examples */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Exemplos rápidos
        </p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => applyExample(ex)}
              disabled={submitting}
              className="text-xs px-3 py-1.5 rounded-full border border-border bg-muted/40 text-muted-foreground hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50"
            >
              {ex.slice(0, 50)}…
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <p id="briefing-error" role="alert" className="text-sm text-danger font-medium">
          {error}
        </p>
      )}

      {/* Submit */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground max-w-sm">
          A extração leva menos de 2 segundos. Você será redirecionado automaticamente.
        </p>
        <Button
          type="submit"
          disabled={!isValid || submitting}
          className="gap-2 min-w-[160px]"
        >
          {submitting ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              Processando…
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Analisar briefing
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

export function BriefingFormSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-4 bg-muted rounded w-40" />
        <div className="h-48 bg-muted rounded-lg" />
        <div className="h-3 bg-muted rounded w-24" />
      </div>
      <div className="h-10 bg-muted rounded-lg w-44 ml-auto" />
    </div>
  );
}

export function EmptyBriefingsState() {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <FileText className="w-8 h-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">Nenhum briefing ainda</h3>
      <p className="text-muted-foreground text-sm max-w-xs mb-6">
        Cole a primeira mensagem de cliente para começar a usar o PropMatch AI.
      </p>
      <Button onClick={() => router.push('/briefings/new')} className="gap-2">
        <Send className="w-4 h-4" />
        Criar primeiro briefing
      </Button>
    </div>
  );
}
