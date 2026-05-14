'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Archive, ArchiveRestore, FileText, Phone, User } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import {
  CLIENT_CRM_STATUS_LABELS,
  CLIENT_CRM_STATUS_COLORS,
  CLIENT_URGENCY_LABELS,
} from '@/lib/schemas/client';

interface Client {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isGuest: boolean;
  archiveStatus: 'active' | 'soft_archived' | 'pending_delete';
  crmStatus: 'ativo' | 'negociacao' | 'fechado' | 'pausado';
  urgency: 'ativo' | 'prazo' | 'explorando';
  notes: string | null;
  createdAt: string;
  _count: { briefings: number };
}

export function ClientList() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
        const res = await apiFetch(`/api/v1/clients${showArchived ? '?archived=true' : ''}`, {
    });
    const data = (await res.json()) as { clients?: Client[] };
    setClients(data.clients ?? []);
    setLoading(false);
  }, [showArchived]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  async function archive(id: string) {
    setActionId(id);
        await apiFetch(`/api/v1/clients/${id}`, {
      method: 'DELETE',
    });
    await loadClients();
    setActionId(null);
  }

  async function restore(id: string) {
    setActionId(id);
        await apiFetch(`/api/v1/clients/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ archiveStatus: 'active' }),
    });
    await loadClients();
    setActionId(null);
  }

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowArchived((v) => !v)}
          className="text-xs text-muted-foreground underline"
        >
          {showArchived ? 'Ocultar arquivados' : 'Ver arquivados'}
        </button>
      </div>

      {clients.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">
            {showArchived ? 'Nenhum cliente arquivado.' : 'Nenhum cliente salvo ainda.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
          {clients.map((c) => (
            <div key={c.id} className="flex items-center gap-4 px-5 py-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-primary" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-2">
                  <Link
                    href={`/clients/${c.id}`}
                    className="font-medium text-sm text-foreground hover:text-primary transition-colors truncate"
                  >
                    {c.name}
                  </Link>
                  {/* CRM status badge */}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${CLIENT_CRM_STATUS_COLORS[c.crmStatus]}`}>
                    {CLIENT_CRM_STATUS_LABELS[c.crmStatus]}
                  </span>
                  {c.isGuest && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                      guest
                    </span>
                  )}
                  {c.archiveStatus !== 'active' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">
                      arquivado
                    </span>
                  )}
                </div>
                <div className="flex items-center flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{CLIENT_URGENCY_LABELS[c.urgency]}</span>
                  {c.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {c.phone}
                    </span>
                  )}
                  <Link
                    href={`/briefings?client_id=${c.id}`}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    <FileText className="w-3 h-3" />
                    {c._count.briefings} briefing{c._count.briefings !== 1 ? 's' : ''}
                  </Link>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-1">
                <Link
                  href={`/clients/${c.id}`}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
                >
                  Ver perfil
                </Link>
                {c.archiveStatus === 'active' ? (
                  <button
                    onClick={() => archive(c.id)}
                    disabled={actionId === c.id}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => restore(c.id)}
                    disabled={actionId === c.id}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <ArchiveRestore className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
