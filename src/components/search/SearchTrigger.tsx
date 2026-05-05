'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface SearchTriggerProps {
  briefingId: string;
}

export function SearchTrigger({ briefingId }: SearchTriggerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/v1/briefings/${briefingId}/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getAccessToken()}`,
        },
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: { user_message?: string } };
        throw new Error(body.error?.user_message ?? 'Erro ao iniciar busca.');
      }

      // Reload page to show SearchResults component
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido.');
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleSearch} disabled={loading} className="gap-2">
        {loading ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
            Iniciando busca…
          </>
        ) : (
          'Buscar imóveis'
        )}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function getAccessToken(): string {
  // Access token is stored in memory by the auth flow.
  // For MVP we read from sessionStorage where the login page saves it.
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem('access_token') ?? '';
  }
  return '';
}
