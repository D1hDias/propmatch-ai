'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';

export function NewClientForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setError('');
    setSubmitting(true);

    
    try {
      const res = await apiFetch('/api/v1/clients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: { user_message?: string } };
        throw new Error(data.error?.user_message ?? 'Erro ao cadastrar cliente.');
      }

      router.push('/clients');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground" htmlFor="client-name">
          Nome <span className="text-destructive">*</span>
        </label>
        <input
          id="client-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="João da Silva"
          maxLength={200}
          disabled={submitting}
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground" htmlFor="client-phone">
          Telefone
          <span className="ml-1 text-xs text-muted-foreground">(formato: +5511999999999)</span>
        </label>
        <input
          id="client-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+5511987654321"
          disabled={submitting}
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground" htmlFor="client-notes">
          Observações
        </label>
        <textarea
          id="client-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Preferências, histórico de busca, observações gerais…"
          rows={3}
          maxLength={2000}
          disabled={submitting}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60 resize-none"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!name.trim() || submitting} className="gap-2">
          {submitting ? <Loader className="w-4 h-4 animate-spin" /> : null}
          Salvar cliente
        </Button>
      </div>
    </form>
  );
}
