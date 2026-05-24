'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil, Search } from 'lucide-react';
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

function buildEditUrl(briefing: BriefingDetail): string {
  const c = briefing.extractedCriteria;
  const p = new URLSearchParams();
  // intent: "buy" → purpose: "sale", "rent" → "rent"
  if (c?.intent) p.set('purpose', c.intent === 'rent' ? 'rent' : 'sale');
  if (c?.hard_filters?.property_type) p.set('propertyType', c.hard_filters.property_type);
  const hoods = c?.location?.neighborhoods ?? [];
  if (hoods.length) p.set('neighborhoods', hoods.join(','));
  if (c?.hard_filters?.price_min != null) p.set('priceMin', String(c.hard_filters.price_min));
  if (c?.hard_filters?.price_max != null) p.set('priceMax', String(c.hard_filters.price_max));
  if (c?.hard_filters?.bedrooms_min != null) p.set('bedroomsMin', String(c.hard_filters.bedrooms_min));
  if (c?.hard_filters?.parking_min != null) p.set('parkingMin', String(c.hard_filters.parking_min));
  if (c?.hard_filters?.area_min_m2 != null) p.set('areaMin', String(c.hard_filters.area_min_m2));
  if (c?.hard_filters?.area_max_m2 != null) p.set('areaMax', String(c.hard_filters.area_max_m2));
  if (briefing.client?.id && !briefing.client.isGuest) p.set('clientId', briefing.client.id);
  return `/briefings/new?${p.toString()}`;
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

  // Poll while extraction or search is in progress
  useEffect(() => {
    if (briefing?.status !== 'extracting' && briefing?.status !== 'searching') return;
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
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="h-8 w-48 bg-skeleton rounded animate-pulse" />
        <div className="h-48 bg-skeleton rounded-xl animate-pulse" />
        <div className="h-64 bg-skeleton rounded-xl animate-pulse" />
      </div>
    );
  }

  if (briefing === null) return notFound();

  const isReady = briefing.status === 'ready';
  const isSearching = briefing.status === 'searching';
  const isFailed = briefing.status === 'failed';
  const client = briefing.client;

  return (
    <div className="max-w-[1600px] mx-auto space-y-8">
      {/* Breadcrumb / nav */}
      <div className="flex items-center justify-between">
        <Link
          href="/historico"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Histórico
        </Link>
        <div className="flex items-center gap-2">
          {isReady && briefing.extractedCriteria && (
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href={buildEditUrl(briefing)}>
                <Pencil className="w-4 h-4" />
                Editar busca
              </Link>
            </Button>
          )}
          <Button asChild size="sm" variant="default" className="gap-1.5">
            <Link href="/briefings/new">
              <Search className="w-4 h-4" />
              Nova Busca
            </Link>
          </Button>
        </div>
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
          {(isSearching || isReady || isFailed) && <SearchResults briefingId={id} clientName={client?.name} />}
        </section>
      )}
    </div>
  );
}
