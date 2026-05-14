'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { ExtractionResult } from '@/components/briefings/ExtractionResult';
import { SearchTrigger } from '@/components/search/SearchTrigger';
import { SearchResults } from '@/components/search/SearchResults';
import { GuestArchiveBanner } from '@/components/clients/GuestArchiveBanner';
import { Button } from '@/components/ui/button';
import type { ExtractedCriteria } from '@/server/briefings/extract';
import { apiFetch } from '@/lib/api-fetch';

interface BriefingDetail {
  id: string;
  rawText: string;
  status: 'extracting' | 'searching' | 'ready' | 'failed';
  reviewStatus: string;
  extractionConfidence: number | null;
  extractedCriteria: ExtractedCriteria | null;
  createdAt: string;
  hitlMetrics: { queuedAt: string }[];
  client?: { id: string; name: string; isGuest: boolean; createdAt: string; softArchivedAt: string | null };
}

interface Props {
  params: Promise<{ id: string }>;
}

export default function BriefingDetailPage({ params }: Props) {
  const { id } = use(params);
  const [briefing, setBriefing] = useState<BriefingDetail | null | undefined>(undefined);

  // Initial fetch
  useEffect(() => {
    apiFetch(`/api/v1/briefings/${id}`)
      .then((r) => {
        if (r.status === 404) { setBriefing(null); return null; }
        if (!r.ok) throw new Error('fetch failed');
        return r.json();
      })
      .then((d) => { if (d !== null) setBriefing(d as BriefingDetail); })
      .catch(() => setBriefing(null));
  }, [id]);

  // Poll while extraction is in progress so the search section appears automatically
  useEffect(() => {
    if (briefing?.status !== 'extracting') return;
    const interval = setInterval(async () => {
      try {
        const r = await apiFetch(`/api/v1/briefings/${id}`);
        if (!r.ok) return;
        const d = (await r.json()) as BriefingDetail;
        setBriefing(d);
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [id, briefing?.status]);

  if (briefing === undefined) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-48 bg-muted rounded-xl animate-pulse" />
        <div className="h-64 bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  if (briefing === null) return notFound();

  const isReady = briefing.status === 'ready';
  const isSearching = briefing.status === 'searching';
  const client = briefing.client;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Breadcrumb / nav */}
      <div className="flex items-center justify-between">
        <Link
          href="/briefings"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Todos os briefings
        </Link>
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link href="/briefings/new">
            <Plus className="w-4 h-4" />
            Novo briefing
          </Link>
        </Button>
      </div>

      {/* Guest archive warning */}
      {client?.isGuest && (
        <GuestArchiveBanner
          clientId={client.id}
          clientName={client.name}
          createdAt={client.createdAt}
          softArchivedAt={client.softArchivedAt}
        />
      )}

      {/* Extraction result */}
      <div className="bg-card rounded-xl shadow-card p-6 lg:p-8">
        <ExtractionResult
          briefingId={id}
          initialData={briefing}
          onUpdate={(updated) => setBriefing((prev) => prev ? { ...prev, ...updated } : prev)}
        />
      </div>

      {/* Search section */}
      {briefing.extractedCriteria && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Imóveis encontrados</h2>
            {!isSearching && (
              <SearchTrigger briefingId={id} />
            )}
          </div>
          {(isSearching || isReady) && <SearchResults briefingId={id} />}
        </section>
      )}
    </div>
  );
}
