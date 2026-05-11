'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Target, User, UserPlus } from 'lucide-react';

interface Client {
  id: string;
  name: string;
  phone: string | null;
  isGuest: boolean;
  matchThreshold: number;
  urgency: 'ativo' | 'prazo' | 'explorando';
}

interface ClientSelectorProps {
  value: string | null;
  onChange: (clientId: string | null) => void;
  disabled?: boolean;
}

const URGENCY_LABELS = {
  ativo: 'Buscando ativamente',
  prazo: 'Tem prazo definido',
  explorando: 'Explorando o mercado',
};

export function ClientSelector({ value, onChange, disabled }: ClientSelectorProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('access_token') : null;
    fetch('/api/v1/clients', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((data: { clients?: Client[] }) => setClients(data.clients ?? []))
      .catch(() => setClients([]))
      .finally(() => setLoading(false));
  }, []);

  const selected = clients.find((c) => c.id === value) ?? null;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-foreground">
        Cliente
        <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional — cria guest automaticamente)</span>
      </label>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <select
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled || loading}
            className="w-full h-10 pl-9 pr-3 rounded-md border border-input bg-background text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          >
            <option value="">Sem cliente (guest automático)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.phone ? ` · ${formatPhone(c.phone)}` : ''}
              </option>
            ))}
          </select>
        </div>

        <Link
          href="/clients/new"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 h-10 px-3 rounded-md border border-input bg-background text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title="Cadastrar novo cliente"
        >
          <UserPlus className="w-4 h-4" />
          <span className="hidden sm:inline">Novo</span>
        </Link>
      </div>

      {/* Preview do cliente selecionado */}
      {selected && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 text-foreground font-medium">
            <Target className="w-3.5 h-3.5 text-primary shrink-0" />
            Match ≥ {selected.matchThreshold}%
          </span>
          <span className="text-border">·</span>
          <span>{URGENCY_LABELS[selected.urgency]}</span>
        </div>
      )}
    </div>
  );
}

function formatPhone(e164: string): string {
  const digits = e164.replace(/^\+55/, '');
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return e164;
}
