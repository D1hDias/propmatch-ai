'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  MapPin, Home, DollarSign, BedDouble, Maximize2,
  Car, CheckCircle, Clock, AlertCircle, Loader,
  RefreshCw, Wifi,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-fetch';
import type { ExtractedCriteria } from '@/server/briefings/extract';

// ---------------------------------------------------------------------------
// Types matching the API response shape
// ---------------------------------------------------------------------------

interface Briefing {
  id: string;
  rawText: string;
  status: 'extracting' | 'searching' | 'ready' | 'failed';
  reviewStatus: string;
  extractionConfidence: number | null;
  extractedCriteria: ExtractedCriteria | null;
  createdAt: string;
  hitlMetrics: { queuedAt: string }[];
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status, reviewStatus }: { status: string; reviewStatus: string }) {
  if (status === 'extracting') {
    return (
      <Badge className="gap-1.5 bg-secondary/10 text-secondary hover:bg-secondary/10">
        <Loader className="w-3 h-3 animate-spin" />
        Extraindo critérios…
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge className="gap-1.5 bg-danger/10 text-danger hover:bg-danger/10">
        <AlertCircle className="w-3 h-3" />
        Extração falhou
      </Badge>
    );
  }
  if (reviewStatus === 'pending') {
    return (
      <Badge className="gap-1.5 bg-warning/10 text-warning hover:bg-warning/10">
        <Clock className="w-3 h-3" />
        Em revisão humana
      </Badge>
    );
  }
  return (
    <Badge className="gap-1.5 bg-success/10 text-success hover:bg-success/10">
      <CheckCircle className="w-3 h-3" />
      Pronto
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Confidence bar
// ---------------------------------------------------------------------------

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 85 ? 'bg-success' : pct >= 80 ? 'bg-warning' : 'bg-secondary';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Confiança da extração</span>
        <span className="font-semibold">{pct}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Criteria grid
// ---------------------------------------------------------------------------

function CriteriaGrid({ criteria }: { criteria: ExtractedCriteria }) {
  const items = [
    {
      icon: MapPin,
      label: 'Localização',
      value: [criteria.city, ...(criteria.neighborhoods ?? [])].filter(Boolean).join(', ') || null,
    },
    {
      icon: Home,
      label: 'Tipo',
      value: criteria.property_type
        ? { apartment: 'Apartamento', house: 'Casa', studio: 'Studio', commercial: 'Comercial', land: 'Terreno' }[criteria.property_type]
        : null,
    },
    {
      icon: BedDouble,
      label: 'Quartos',
      value:
        criteria.bedrooms_min != null
          ? criteria.bedrooms_max != null && criteria.bedrooms_max !== criteria.bedrooms_min
            ? `${criteria.bedrooms_min}–${criteria.bedrooms_max}`
            : `${criteria.bedrooms_min}+`
          : null,
    },
    {
      icon: Maximize2,
      label: 'Área',
      value:
        criteria.area_min_m2 != null || criteria.area_max_m2 != null
          ? [criteria.area_min_m2 && `${criteria.area_min_m2}m²`, criteria.area_max_m2 && `até ${criteria.area_max_m2}m²`]
              .filter(Boolean)
              .join(' — ')
          : null,
    },
    {
      icon: DollarSign,
      label: 'Preço',
      value:
        criteria.price_max != null
          ? `até R$ ${criteria.price_max.toLocaleString('pt-BR')}`
          : null,
    },
    {
      icon: Car,
      label: 'Vagas',
      value: criteria.parking_spots != null ? `${criteria.parking_spots} vaga(s)` : null,
    },
  ].filter((i) => i.value !== null);

  const flags = [
    criteria.near_metro && 'Perto do metrô',
    criteria.pet_friendly && 'Aceita pets',
    criteria.furnished && 'Mobiliado',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-sm font-semibold text-foreground">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {criteria.amenities && criteria.amenities.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">Comodidades</p>
          <div className="flex flex-wrap gap-2">
            {criteria.amenities.map((a) => (
              <Badge key={a} variant="secondary" className="text-xs">
                {a}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {flags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {flags.map((f) => (
            <Badge key={f} className="text-xs bg-success/10 text-success hover:bg-success/10">
              <CheckCircle className="w-3 h-3 mr-1" />
              {f}
            </Badge>
          ))}
        </div>
      )}

      {criteria.notes && (
        <p className="text-sm text-muted-foreground italic border-l-2 border-primary/30 pl-3">
          {criteria.notes}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component — polls until status is no longer 'extracting'
// ---------------------------------------------------------------------------

interface ExtractionResultProps {
  briefingId: string;
  initialData: Briefing;
  onUpdate?: (updated: Briefing) => void;
}

export function ExtractionResult({ briefingId, initialData, onUpdate }: ExtractionResultProps) {
  const [data, setData] = useState<Briefing>(initialData);
  const [polling, setPolling] = useState(initialData.status === 'extracting');

  const fetchBriefing = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/v1/briefings/${briefingId}`);
      if (!res.ok) return;
      const updated = (await res.json()) as Briefing;
      setData(updated);
      if (updated.status !== 'extracting') {
        setPolling(false);
        onUpdate?.(updated);
      }
    } catch {
      setPolling(false);
    }
  }, [briefingId, onUpdate]);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(fetchBriefing, 1500);
    return () => clearInterval(interval);
  }, [polling, fetchBriefing]);

  const isProcessing = data.status === 'extracting';
  const isFailed = data.status === 'failed';
  const isHitl = data.reviewStatus === 'pending';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 flex-1">
          <StatusBadge status={data.status} reviewStatus={data.reviewStatus} />
          <p className="text-xs text-muted-foreground mt-2">
            {new Date(data.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
          </p>
        </div>
        {polling && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
            <Wifi className="w-3 h-3" />
            Atualizando…
          </span>
        )}
      </div>

      {/* Raw text */}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Texto original
        </p>
        <p className="text-sm text-foreground bg-muted/30 rounded-lg p-4 leading-relaxed">
          {data.rawText}
        </p>
      </div>

      {/* Processing state */}
      {isProcessing && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Loader className="w-10 h-10 text-primary animate-spin mb-4" />
          <p className="font-semibold text-foreground">Extraindo critérios…</p>
          <p className="text-sm text-muted-foreground mt-1">Isso leva menos de 2 segundos.</p>
        </div>
      )}

      {/* Failed state */}
      {isFailed && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="w-10 h-10 text-danger mb-4" />
          <p className="font-semibold text-foreground">Não consegui extrair os critérios</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            O texto pode ser muito curto ou ambíguo. Tente reformular ou preencha manualmente.
          </p>
          <Button
            variant="outline"
            className="mt-4 gap-2"
            onClick={() => { window.location.href = '/briefings/new'; }}
          >
            <RefreshCw className="w-4 h-4" />
            Tentar novamente
          </Button>
        </div>
      )}

      {/* HITL pending state */}
      {!isProcessing && !isFailed && isHitl && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
          <div className="flex gap-3">
            <Clock className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground">Em revisão humana</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Não ficou 100% claro em alguns campos. Nossa equipe vai revisar e confirmar os
                critérios em instantes.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Extracted criteria */}
      {!isProcessing && !isFailed && data.extractedCriteria && (
        <div className="space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Critérios extraídos
          </p>
          {data.extractionConfidence != null && (
            <ConfidenceBar value={data.extractionConfidence} />
          )}
          <CriteriaGrid criteria={data.extractedCriteria} />
        </div>
      )}
    </div>
  );
}
