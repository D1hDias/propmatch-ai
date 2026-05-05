'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Archive, ArchiveRestore, FileText, Phone, User } from 'lucide-react';

interface Client {
  id: string;
  name: string;
  phone: string | null;
  isGuest: boolean;
  archiveStatus: 'active' | 'soft_archived' | 'pending_delete';
  notes: string | null;
  createdAt: string;
  _count: { briefings: number };
}

export function ClientList() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    loadClients();
  }, [showArchived]);

  async function loadClients() {
    setLoading(true);
    const token = sessionStorage.getItem('access_token');
    const res = await fetch(`/api/v1/clients${showArchived ? '?archived=true' : ''}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = (await res.json()) as { clients?: Client[] };
    setClients(data.clients ?? []);
    setLoading(false);
  }

  async function archive(id: string) {
    setActionId(id);
    const token = sessionStorage.getItem('access_token');
    await fetch(`/api/v1/clients/${id}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    await loadClients();
    setActionId(null);
  }

  async function restore(id: string) {
    setActionId(id);
    const token = sessionStorage.getItem('access_token');
    await fetch(`/api/v1/clients/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
          <div key={i} className="h-16 bg-muted rounded-xl" />
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
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-primary" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm text-foreground truncate">{c.name}</p>
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
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
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

              <div className="shrink-0">
                {c.archiveStatus === 'active' ? (
                  <button
                    onClick={() => archive(c.id)}
                    disabled={actionId === c.id}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Arquivar
                  </button>
                ) : (
                  <button
                    onClick={() => restore(c.id)}
                    disabled={actionId === c.id}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <ArchiveRestore className="w-3.5 h-3.5" />
                    Restaurar
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
