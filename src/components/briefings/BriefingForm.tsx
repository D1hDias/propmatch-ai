'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ClientSelector } from '@/components/clients/ClientSelector';
import { PartnerSiteList } from '@/components/partners/PartnerSiteList';
import { NeighborhoodSelector } from './NeighborhoodSelector';
import { PROPERTY_TYPES } from '@/lib/constants/property-types';
import { apiFetch } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';
import {
  Loader,
  Send,
  FileText,
  MessageSquare,
  MapPin,
  ChevronDown,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTEXT_CHARS = 1000;
const BEDROOM_OPTIONS = [0, 1, 2, 3, 4, 5];
const PARKING_OPTIONS = [0, 1, 2, 3, 4];

// ---------------------------------------------------------------------------
// Shared source selector
// ---------------------------------------------------------------------------

interface SourceSelectorProps {
  selectedPartnerIds: string[];
  onSelectionChange: (ids: string[]) => void;
  disabled: boolean;
}

function SourceSelector({ selectedPartnerIds, onSelectionChange, disabled: _disabled }: SourceSelectorProps) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">Onde buscar</p>
      <p className="text-xs text-muted-foreground">
        Selecione os sites parceiros que serão consultados.
      </p>
      <PartnerSiteList
        selectable
        maxSelectable={5}
        selectedIds={selectedPartnerIds}
        onSelectionChange={onSelectionChange}
      />
      {selectedPartnerIds.length === 0 && (
        <p className="text-xs text-destructive">Selecione pelo menos um site parceiro.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NumberSelector — picker for bedrooms / parking
// ---------------------------------------------------------------------------

interface NumberSelectorProps {
  label: string;
  options: number[];
  value: number | null;
  onChange: (v: number | null) => void;
  formatLabel?: (n: number) => string;
  disabled?: boolean;
}

function NumberSelector({
  label,
  options,
  value,
  onChange,
  formatLabel,
  disabled,
}: NumberSelectorProps) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onChange(value === opt ? null : opt)}
            className={cn(
              'min-w-[38px] h-9 px-3 rounded-lg border text-sm font-medium transition-colors',
              value === opt
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {formatLabel ? formatLabel(opt) : opt === 0 ? 'Qualquer' : `${opt}+`}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PriceField
// ---------------------------------------------------------------------------

interface PriceFieldProps {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

function PriceField({ label, value, onChange, placeholder, disabled }: PriceFieldProps) {
  function handleChange(raw: string) {
    const digits = raw.replace(/\D/g, '');
    onChange(digits ? parseInt(digits, 10) : null);
  }

  function fmt(n: number | null): string {
    if (!n) return '';
    return n.toLocaleString('pt-BR');
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-muted-foreground">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground select-none">
          R$
        </span>
        <input
          type="text"
          inputMode="numeric"
          placeholder={placeholder ?? '0'}
          value={fmt(value)}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
          className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-muted/30 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AreaField
// ---------------------------------------------------------------------------

interface AreaFieldProps {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

function AreaField({ label, value, onChange, placeholder, disabled }: AreaFieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-muted-foreground">{label}</label>
      <div className="relative">
        <input
          type="number"
          min={0}
          max={10000}
          placeholder={placeholder ?? '0'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          disabled={disabled}
          className="w-full pr-10 pl-3 py-2.5 rounded-lg border border-border bg-muted/30 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground select-none">
          m²
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main BriefingForm
// ---------------------------------------------------------------------------

export function BriefingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Global
  const [clientId, setClientId] = useState<string | null>(() => searchParams.get('clientId'));
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<string[]>(() => {
    const ids = searchParams.get('partnerIds');
    return ids ? ids.split(',').filter(Boolean) : [];
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Structured criteria — initialized from query params on first render (no flash)
  const [purpose, setPurpose] = useState<'sale' | 'rent'>(() => {
    const p = searchParams.get('purpose');
    return p === 'rent' ? 'rent' : 'sale';
  });
  const [propertyTypes, setPropertyTypes] = useState<string[]>(() => {
    const pt = searchParams.get('propertyType');
    return pt ? [pt] : [];
  });
  const [neighborhoods, setNeighborhoods] = useState<string[]>(() => {
    const hoods = searchParams.get('neighborhoods');
    return hoods ? hoods.split(',').filter(Boolean) : [];
  });
  const [priceMin, setPriceMin] = useState<number | null>(() => {
    const v = searchParams.get('priceMin');
    return v ? Number(v) : null;
  });
  const [priceMax, setPriceMax] = useState<number | null>(() => {
    const v = searchParams.get('priceMax');
    return v ? Number(v) : null;
  });
  const [bedroomsMin, setBedroomsMin] = useState<number | null>(() => {
    const v = searchParams.get('bedroomsMin');
    return v ? Number(v) : null;
  });
  const [parkingMin, setParkingMin] = useState<number | null>(() => {
    const v = searchParams.get('parkingMin');
    return v ? Number(v) : null;
  });
  const [areaMin, setAreaMin] = useState<number | null>(() => {
    const v = searchParams.get('areaMin');
    return v ? Number(v) : null;
  });
  const [areaMax, setAreaMax] = useState<number | null>(() => {
    const v = searchParams.get('areaMax');
    return v ? Number(v) : null;
  });

  // Optional client message (additional context)
  const [showContext, setShowContext] = useState(false);
  const [additionalContext, setAdditionalContext] = useState('');
  const contextRef = useRef<HTMLTextAreaElement>(null);

  const hasAnyCriteria =
    neighborhoods.length > 0 ||
    priceMin !== null ||
    priceMax !== null ||
    bedroomsMin !== null ||
    parkingMin !== null ||
    areaMin !== null ||
    areaMax !== null;

  const isValid = selectedPartnerIds.length > 0 && hasAnyCriteria;

  function togglePropertyType(value: string) {
    setPropertyTypes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  function handleToggleContext() {
    setShowContext((v) => !v);
    if (!showContext) {
      // Give DOM time to render before focusing
      setTimeout(() => contextRef.current?.focus(), 50);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;
    await submitBriefing();
  }

  const submitBriefing = useCallback(async () => {
    setError('');
    setSubmitting(true);

    try {
      // Build synthetic raw_text from structured fields for the extraction pipeline
      const parts: string[] = [];
      if (purpose === 'rent') parts.push('para alugar');
      if (propertyTypes.length > 0) {
        const labels = PROPERTY_TYPES.filter((t) => propertyTypes.includes(t.value))
          .map((t) => t.label)
          .join(', ');
        parts.push(labels);
      }
      if (neighborhoods.length > 0) {
        parts.push(`em ${neighborhoods.join(' ou ')}`);
      }
      if (priceMin !== null && priceMax !== null) {
        parts.push(`entre R$ ${priceMin.toLocaleString('pt-BR')} e R$ ${priceMax.toLocaleString('pt-BR')}`);
      } else if (priceMax !== null) {
        parts.push(`até R$ ${priceMax.toLocaleString('pt-BR')}`);
      } else if (priceMin !== null) {
        parts.push(`a partir de R$ ${priceMin.toLocaleString('pt-BR')}`);
      }
      if (bedroomsMin !== null && bedroomsMin > 0) {
        parts.push(`${bedroomsMin}+ quartos`);
      }
      if (parkingMin !== null && parkingMin > 0) {
        parts.push(`${parkingMin}+ vagas`);
      }
      if (areaMin !== null || areaMax !== null) {
        if (areaMin !== null && areaMax !== null) {
          parts.push(`${areaMin}m² a ${areaMax}m²`);
        } else if (areaMin !== null) {
          parts.push(`a partir de ${areaMin}m²`);
        } else {
          parts.push(`até ${areaMax}m²`);
        }
      }

      let rawText = parts.join(', ') || 'imóvel no Rio de Janeiro';
      if (additionalContext.trim()) {
        rawText = `${rawText}. Contexto adicional: ${additionalContext.trim()}`;
      }

      const payload: Record<string, unknown> = {
        partner_site_ids: selectedPartnerIds,
        ...(clientId ? { client_id: clientId } : {}),
        custom_urls: [],
        raw_text: rawText,
        structured_criteria: {
          purpose,
          property_types: propertyTypes,
          neighborhoods,
          price_min: priceMin,
          price_max: priceMax,
          bedrooms_min: bedroomsMin,
          parking_min: parkingMin,
          area_min: areaMin,
          area_max: areaMax,
          city: 'Rio de Janeiro',
        },
      };

      const res = await apiFetch('/api/v1/briefings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: { user_message?: string } };
        throw new Error(data.error?.user_message ?? 'Erro ao enviar briefing.');
      }

      const data = (await res.json()) as { id: string };
      router.push(`/briefings/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado. Tente novamente.');
      setSubmitting(false);
    }
  }, [
    clientId, selectedPartnerIds, additionalContext,
    purpose, propertyTypes, neighborhoods,
    priceMin, priceMax, bedroomsMin, parkingMin, areaMin, areaMax,
    router,
  ]);

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6 items-start">

        {/* ── Left column: all criteria ── */}
        <div className="bg-card rounded-xl shadow-card p-6 lg:p-8 space-y-6">

          {/* Client selector */}
          <ClientSelector value={clientId} onChange={setClientId} disabled={submitting} />

          {/* Finalidade */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Finalidade</p>
            <div className="flex gap-2">
              {(['sale', 'rent'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  disabled={submitting}
                  onClick={() => setPurpose(opt)}
                  className={cn(
                    'flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors',
                    purpose === opt
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:bg-primary/5',
                  )}
                >
                  {opt === 'sale' ? 'Compra' : 'Aluguel'}
                </button>
              ))}
            </div>
          </div>

          {/* Tipo de imóvel */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Tipo do imóvel</p>
            <p className="text-xs text-muted-foreground">Deixe em branco para buscar todos.</p>
            <div className="flex flex-wrap gap-1.5">
              {PROPERTY_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  disabled={submitting}
                  onClick={() => togglePropertyType(t.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-full border text-xs font-medium transition-colors',
                    propertyTypes.includes(t.value)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/30 hover:text-primary hover:bg-primary/5',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cidade — locked */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Cidade</p>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-muted/20 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="text-foreground font-medium">Rio de Janeiro</span>
              <span className="text-xs ml-auto">MVP</span>
            </div>
          </div>

          {/* Bairros */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Bairro(s)</p>
            <NeighborhoodSelector
              value={neighborhoods}
              onChange={setNeighborhoods}
              disabled={submitting}
            />
          </div>

          {/* Faixa de preço */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Faixa de preço</p>
            <div className="grid grid-cols-2 gap-3">
              <PriceField
                label="Preço mínimo"
                value={priceMin}
                onChange={setPriceMin}
                placeholder="200.000"
                disabled={submitting}
              />
              <PriceField
                label="Preço máximo"
                value={priceMax}
                onChange={setPriceMax}
                placeholder="1.500.000"
                disabled={submitting}
              />
            </div>
          </div>

          {/* Quartos */}
          <NumberSelector
            label="Quartos"
            options={BEDROOM_OPTIONS}
            value={bedroomsMin}
            onChange={setBedroomsMin}
            disabled={submitting}
          />

          {/* Vagas */}
          <NumberSelector
            label="Vagas"
            options={PARKING_OPTIONS}
            value={parkingMin}
            onChange={setParkingMin}
            disabled={submitting}
          />

          {/* Área */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Área</p>
            <div className="grid grid-cols-2 gap-3">
              <AreaField
                label="Mínima"
                value={areaMin}
                onChange={setAreaMin}
                placeholder="40"
                disabled={submitting}
              />
              <AreaField
                label="Máxima"
                value={areaMax}
                onChange={setAreaMax}
                placeholder="500"
                disabled={submitting}
              />
            </div>
          </div>

          {/* Mensagem do cliente — opcional */}
          <div className="rounded-xl border border-border overflow-hidden">
            <button
              type="button"
              onClick={handleToggleContext}
              disabled={submitting}
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">
                  Mensagem do cliente
                </span>
                <span className="text-xs text-muted-foreground">(opcional)</span>
              </div>
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform',
                  showContext && 'rotate-180',
                )}
              />
            </button>
            {showContext && (
              <div className="p-4 space-y-2 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Cole a mensagem original do cliente para enriquecer o match com detalhes adicionais.
                </p>
                <textarea
                  ref={contextRef}
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value.slice(0, MAX_CONTEXT_CHARS))}
                  placeholder="Ex: prefere andar alto, aceita planta, mora com 2 pets…"
                  rows={4}
                  disabled={submitting}
                  className="briefing-input resize-none w-full text-sm"
                />
                <p className="text-xs text-muted-foreground text-right">
                  {additionalContext.length}/{MAX_CONTEXT_CHARS}
                </p>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <p role="alert" className="text-sm text-danger font-medium">
              {error}
            </p>
          )}

          {/* Submit */}
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground max-w-xs">
              Os filtros são aplicados diretamente na busca.
            </p>
            <Button
              type="submit"
              disabled={!isValid || submitting}
              className="gap-2 min-w-[160px]"
            >
              {submitting ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Processando…
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Buscar imóveis
                </>
              )}
            </Button>
          </div>
        </div>

        {/* ── Right column: source selection (sticky) ── */}
        <div className="lg:sticky lg:top-[calc(var(--header-height)+2rem)] lg:self-start">
          <div className="rounded-xl border border-border bg-muted/10 p-5">
            <SourceSelector
              selectedPartnerIds={selectedPartnerIds}
              onSelectionChange={setSelectedPartnerIds}
              disabled={submitting}
            />
          </div>
        </div>

      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function BriefingFormSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-4 bg-skeleton rounded w-40" />
        <div className="h-48 bg-skeleton rounded-lg" />
        <div className="h-3 bg-skeleton rounded w-24" />
      </div>
      <div className="h-10 bg-skeleton rounded-lg w-44 ml-auto" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function EmptyBriefingsState() {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <FileText className="w-8 h-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">Nenhum briefing ainda</h3>
      <p className="text-muted-foreground text-sm max-w-xs mb-6">
        Preencha os critérios do cliente para começar a usar o PropMatch AI.
      </p>
      <Button onClick={() => router.push('/briefings/new')} className="gap-2">
        <Send className="w-4 h-4" />
        Criar primeiro briefing
      </Button>
    </div>
  );
}
