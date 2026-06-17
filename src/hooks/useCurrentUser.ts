'use client';

import { useEffect, useState } from 'react';
import { getTokenPayload } from '@/lib/auth-token';
import { apiFetch } from '@/lib/api-fetch';

interface CurrentUser {
  name: string;
  email: string;
  initials: string;
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    // Pré-preenche imediatamente com o token local para evitar piscar
    const payload = getTokenPayload();
    if (payload) {
      setUser({
        name: '',
        email: payload.email,
        initials: payload.email[0]!.toUpperCase(),
      });
    }

    apiFetch('/api/v1/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { name?: string; email?: string } | null) => {
        if (!data) return;
        const name = data.name ?? '';
        setUser({
          name,
          email: data.email ?? '',
          initials: name ? deriveInitials(name) : (data.email?.[0]?.toUpperCase() ?? '?'),
        });
      })
      .catch(() => {/* mantém estado anterior */});
  }, []);

  return user;
}
