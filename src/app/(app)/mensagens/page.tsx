'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { MessageSquare, Copy, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { apiFetch } from '@/lib/api-fetch';
import { toastError, toastSuccess } from '@/lib/toast';

type Message = {
  id: string;
  briefingId: string;
  clientId: string;
  formattedText: string;
  deliveryMethod: string;
  deliveryStatus: string;
  createdAt: string;
  client: { id: string; name: string };
  briefing: { id: string; rawText: string };
};

function MessageCard({ msg }: { msg: Message }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(msg.formattedText);
      setCopied(true);
      toastSuccess('Mensagem copiada para a área de transferência!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastError('Não foi possível copiar. Selecione o texto manualmente.');
    }
  }, [msg.formattedText]);

  return (
    <div className="bg-card rounded-xl shadow-card p-5 space-y-3 animate-fade-in-up card-hover">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">{msg.client.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{msg.briefing.rawText}</p>
        </div>
        <time className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {new Date(msg.createdAt).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      </div>

      <div className="bg-muted/40 rounded-lg p-4 max-h-40 overflow-y-auto">
        <pre className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed">{msg.formattedText}</pre>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={handleCopy}>
          {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado!' : 'Copiar mensagem'}
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" asChild>
          <Link href={`/briefings/${msg.briefingId}`}>
            <ExternalLink className="w-3.5 h-3.5" />
            Ver briefing
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default function MensagensPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/v1/messages?per_page=20')
      .then((r) => r.json())
      .then((d: { items?: Message[]; total?: number; error?: unknown }) => {
        if (d.error) {
          toastError('Não foi possível carregar o histórico de mensagens.');
        } else {
          setMessages(d.items ?? []);
          setTotal(d.total ?? 0);
        }
      })
      .catch(() => toastError('Erro ao conectar com o servidor.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Mensagens WhatsApp</h2>
        <p className="text-muted-foreground mt-1">
          {loading ? 'Carregando…' : total > 0 ? `${total} mensagens geradas` : 'Nenhuma mensagem gerada ainda'}
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 skeleton rounded-xl" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="bg-card rounded-xl shadow-card">
          <EmptyState
            icon={MessageSquare}
            title="Nenhuma mensagem ainda"
            description="Gere sua primeira mensagem selecionando imóveis em um briefing pronto."
            action={
              <Button asChild variant="outline">
                <Link href="/historico">Ir para histórico</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((msg, i) => (
            <div key={msg.id} style={{ animationDelay: `${i * 60}ms` }}>
              <MessageCard msg={msg} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
