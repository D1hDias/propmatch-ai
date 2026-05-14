'use client';

import { useState } from 'react';
import { ChevronRight, Expand } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';

export interface WidenProposal {
  label: string;
  description: string;
  criteria: Record<string, unknown>;
}

interface WidenProposalsProps {
  briefingId: string;
  proposals: WidenProposal[];
  onWidenStarted: () => void;
}

export function WidenProposals({ briefingId, proposals, onWidenStarted }: WidenProposalsProps) {
  const [loading, setLoading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (proposals.length === 0) return null;

  async function applyWiden(proposal: WidenProposal, index: number) {
    setLoading(index);
    setError(null);

    try {
            const res = await apiFetch(`/api/v1/briefings/${briefingId}/widen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ criteria: proposal.criteria }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { userMessage?: string } }).error?.userMessage ?? 'Erro ao iniciar nova busca.');
      }

      onWidenStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido.');
      setLoading(null);
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-950/20 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Expand className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium text-amber-900 dark:text-amber-200">
            Poucos resultados encontrados
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5">
            Quer ampliar a busca? Escolha uma opção abaixo:
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {proposals.map((proposal, i) => (
          <button
            key={i}
            disabled={loading !== null}
            onClick={() => applyWiden(proposal, i)}
            className="w-full text-left rounded-lg border border-amber-200 dark:border-amber-700/50 bg-white dark:bg-amber-950/30 px-4 py-3 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200 truncate">
                {proposal.label}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 line-clamp-2">
                {proposal.description}
              </p>
            </div>
            {loading === i ? (
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
            ) : (
              <ChevronRight className="w-4 h-4 shrink-0 text-amber-500" />
            )}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
