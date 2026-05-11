'use client';

// FE-11: GuestArchiveBanner — shown on the briefing detail page when the
// associated client is a guest close to auto-archive (d60 lembrete, d90 archival).

import { useState } from 'react';
import { AlertTriangle, X, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface GuestArchiveBannerProps {
  clientId: string;
  clientName: string;
  createdAt: string; // ISO string
  softArchivedAt: string | null;
}

export function GuestArchiveBanner({
  clientId,
  clientName,
  createdAt,
  softArchivedAt,
}: GuestArchiveBannerProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);

  if (dismissed || softArchivedAt) return null;

  const daysSinceCreation = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  // Only show from day 60 onwards
  if (daysSinceCreation < 60) return null;

  const isUrgent = daysSinceCreation >= 80; // 10 days until archival
  const daysLeft = 90 - daysSinceCreation;

  async function saveAsClient() {
    setSaving(true);
    router.push(`/clients/${clientId}/convert`);
    setSaving(false);
  }

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border p-4 ${
        isUrgent
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-950/20'
      }`}
    >
      <AlertTriangle
        className={`w-5 h-5 mt-0.5 shrink-0 ${isUrgent ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}`}
      />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${isUrgent ? 'text-destructive' : 'text-amber-900 dark:text-amber-200'}`}>
          {isUrgent
            ? `Este guest será arquivado em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}!`
            : 'Guest próximo do arquivamento automático'}
        </p>
        <p className={`text-xs mt-0.5 ${isUrgent ? 'text-destructive/80' : 'text-amber-700 dark:text-amber-400'}`}>
          {clientName} é um cliente guest criado há {daysSinceCreation} dias. Salve como cliente para não perder o histórico.
        </p>
        <button
          onClick={saveAsClient}
          disabled={saving}
          className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary underline hover:no-underline"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Salvar como cliente permanente
        </button>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Fechar aviso"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
