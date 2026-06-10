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
  selectedPortals: string[];
  createdAt: string;
  hitlMetrics: { queuedAt: string }[];
  client?: { id: string; name: string; isGuest: boolean; createdAt: string; softArchivedAt: string | null };
}

interface Props {
  params: Promise<{ id: string }>;
}

function buildEditUrl(briefing: BriefingDetail): string {
  // extractedCriteria pode ter dois formatos:
  // 1. ExtractedCriteria (via LLM): { intent, hard_filters: { property_type, price_min, … }, location: { neighborhoods } }
  // 2. SearchCriteria (via formulário direto): { purpose, propertyType, neighborhoods, priceMin, … }
  const c = briefing.extractedCriteria as Record<string, unknown> | null;
  if (!c) return '/briefings/new';

  const p = new URLSearchParams();
  const hf = c.hard_filters as Record<string, unknown> | undefined;
  const loc = c.location as Record<string, unknown> | undefined;

  // purpose / intent
  const purposeVal = (c.intent as string | undefined) ?? (c.purpose as string | undefined);
  if (purposeVal) p.set('purpose', purposeVal === 'rent' ? 'rent' : 'sale');

  // property type
  const propertyType = (hf?.property_type as string | undefined) ?? (c.propertyType as string | undefined);
  if (propertyType) p.set('propertyType', propertyType);

  // neighborhoods
  const hoods = ((loc?.neighborhoods ?? c.neighborhoods) as string[] | undefined) ?? [];
  if (hoods.length) p.set('neighborhoods', hoods.join(','));

  // prices
  const priceMin = (hf?.price_min as number | undefined) ?? (c.priceMin as number | undefined);
  if (priceMin != null) p.set('priceMin', String(priceMin));

  const priceMax = (hf?.price_max as number | undefined) ?? (c.priceMax as number | undefined);
  if (priceMax != null) p.set('priceMax', String(priceMax));

  // bedrooms
  const bedroomsMin = (hf?.bedrooms_min as number | undefined) ?? (c.bedroomsMin as number | undefined);
  if (bedroomsMin != null) p.set('bedroomsMin', String(bedroomsMin));

  // parking
  const parkingMin = (hf?.parking_min as number | undefined) ?? (c.parkingMin as number | undefined);
  if (parkingMin != null) p.set('parkingMin', String(parkingMin));

  // area
  const areaMin = (hf?.area_min_m2 as number | undefined) ?? (c.areaMin as number | undefined);
  if (areaMin != null) p.set('areaMin', String(areaMin));

  const areaMax = (hf?.area_max_m2 as number | undefined) ?? (c.areaMax as number | undefined);
  if (areaMax != null) p.set('areaMax', String(areaMax));

  if (briefing.client?.id && !briefing.client.isGuest) p.set('clientId', briefing.client.id);
  if (briefing.selectedPortals?.length) p.set('partnerIds', briefing.selectedPortals.join(','));
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
