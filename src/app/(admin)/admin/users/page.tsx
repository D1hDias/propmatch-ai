'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader, AlertTriangle, X, RefreshCw, Shield, ChevronDown } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { Button } from '@/components/ui/button';

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  plan: string;
  createdAt: string;
  lgpdConsentAt: string | null;
  _count: { briefings: number };
}

const ROLES = ['broker', 'owner', 'admin'] as const;
const PLANS = ['free', 'starter', 'pro'] as const;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    const res = await apiFetch('/api/v1/admin/users');
    if (!res.ok) { setLoading(false); return; }
    const data = (await res.json()) as { data: AdminUser[] };
    setUsers(data.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  async function handleUpdate(id: string, field: 'role' | 'plan', value: string) {
    setUpdating(`${id}-${field}`);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { user_message?: string } };
        setError(body.error?.user_message ?? 'Erro ao atualizar.');
        return;
      }
      const updated = (await res.json()) as { data: Pick<AdminUser, 'id' | 'role' | 'plan'> };
      setUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, ...updated.data } : u)),
      );
    } catch {
      setError('Falha de conexão ao atualizar.');
    } finally {
      setUpdating(null);
    }
  }

  const roleColor = (r: string) =>
    r === 'admin' ? 'text-primary font-semibold' :
    r === 'owner' ? 'text-amber-600' :
    'text-muted-foreground';

  const planColor = (p: string) =>
    p === 'pro' ? 'bg-primary/10 text-primary' :
    p === 'starter' ? 'bg-amber-500/10 text-amber-600' :
    'bg-muted text-muted-foreground';

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Usuários</h1>
          <p className="text-sm text-muted-foreground">{users.length} usuários cadastrados</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void fetchUsers()}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Atualizar
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Usuário</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Role</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Plano</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Briefings</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Cadastro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {user.role === 'admin' && (
                        <Shield className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      )}
                      <div>
                        <p className="font-medium">{user.name ?? '—'}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="relative inline-flex items-center">
                      <select
                        value={user.role}
                        disabled={updating === `${user.id}-role`}
                        onChange={(e) => void handleUpdate(user.id, 'role', e.target.value)}
                        className={`appearance-none bg-transparent border border-border rounded px-2 py-0.5 pr-5 text-xs cursor-pointer hover:bg-muted/40 transition-colors disabled:opacity-50 ${roleColor(user.role)}`}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      {updating === `${user.id}-role`
                        ? <Loader className="w-3 h-3 animate-spin absolute right-1 pointer-events-none text-muted-foreground" />
                        : <ChevronDown className="w-3 h-3 absolute right-1 pointer-events-none text-muted-foreground" />
                      }
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="relative inline-flex items-center">
                      <select
                        value={user.plan}
                        disabled={updating === `${user.id}-plan`}
                        onChange={(e) => void handleUpdate(user.id, 'plan', e.target.value)}
                        className={`appearance-none border border-border rounded px-2 py-0.5 pr-5 text-xs cursor-pointer hover:opacity-80 transition-opacity disabled:opacity-50 ${planColor(user.plan)}`}
                      >
                        {PLANS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                      {updating === `${user.id}-plan`
                        ? <Loader className="w-3 h-3 animate-spin absolute right-1 pointer-events-none text-muted-foreground" />
                        : <ChevronDown className="w-3 h-3 absolute right-1 pointer-events-none text-muted-foreground" />
                      }
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {user._count.briefings}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
