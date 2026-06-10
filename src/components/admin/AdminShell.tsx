'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Building2, Users, BarChart3, LogOut, ChevronLeft } from 'lucide-react';
import { isAdmin, getTokenPayload } from '@/lib/auth-token';
import { apiFetch, clearAccessToken } from '@/lib/api-fetch';

const NAV = [
  { href: '/admin/imobi', label: 'Imobiliárias', icon: Building2 },
  { href: '/admin/users', label: 'Usuários', icon: Users },
  { href: '/admin/metrics', label: 'Métricas', icon: BarChart3 },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const payload = getTokenPayload();

  useEffect(() => {
    if (!isAdmin()) {
      router.replace('/dashboard');
      return;
    }
    setReady(true);
  }, [router]);

  async function handleLogout() {
    await apiFetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
    clearAccessToken();
    router.push('/login');
  }

  if (!ready) return null;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border bg-muted/20 flex flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-border">
          <p className="text-xs font-bold text-primary uppercase tracking-widest">PropMatch</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Painel Admin</p>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                pathname.startsWith(href)
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="px-2 py-3 border-t border-border space-y-1">
          <p className="px-3 text-[10px] text-muted-foreground truncate">{payload?.email}</p>
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Voltar ao app
          </Link>
          <button
            onClick={() => void handleLogout()}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
