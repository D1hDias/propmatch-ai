'use client';

import { Bed, Square, ExternalLink, Check, Building } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PropertyCardProps {
  address: string;
  neighborhood: string;
  city: string;
  price: number;
  bedrooms: number;
  area: number;
  fitScore: number;
  imageUrl?: string;
  selected?: boolean;
  onSelect: () => void;
  onViewSource: () => void;
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function getFitScoreClass(score: number): string {
  if (score >= 80) return 'score-high';
  if (score >= 50) return 'score-medium';
  return 'score-low';
}

function getFitScoreBar(score: number): string {
  if (score >= 80) return 'bg-success';
  if (score >= 50) return 'bg-warning';
  return 'bg-danger';
}

export function PropertyCard({
  address,
  neighborhood,
  city,
  price,
  bedrooms,
  area,
  fitScore,
  imageUrl,
  selected = false,
  onSelect,
  onViewSource,
}: PropertyCardProps) {
  return (
    <div
      className={cn(
        'bg-card rounded-lg shadow-card overflow-hidden card-hover transition-all',
        selected && 'card-selected',
      )}
      role="article"
      data-selected={selected}
    >
      {/* Image */}
      <div className="relative h-44 bg-muted flex items-center justify-center overflow-hidden">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={address} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Building className="w-10 h-10" />
            <span className="text-xs">Sem imagem</span>
          </div>
        )}
        {selected && (
          <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
            <Check className="w-4 h-4 text-white" />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-5 space-y-3">
        <div>
          <h3 className="font-semibold text-foreground text-base leading-snug truncate">
            {address}
          </h3>
          <p className="text-sm text-muted-foreground">
            {neighborhood} · {city}
          </p>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-5 text-sm text-foreground">
          <span className="font-bold text-base">{formatPrice(price)}</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Bed className="w-4 h-4" />
            {bedrooms}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Square className="w-4 h-4" />
            {area}m²
          </span>
        </div>

        {/* FitScore */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">FitScore</span>
            <span
              className={cn(
                'text-xs font-semibold px-2 py-0.5 rounded-full',
                getFitScoreClass(fitScore),
              )}
              aria-label={`FitScore: ${fitScore}%`}
            >
              {fitScore}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', getFitScoreBar(fitScore))}
              style={{ width: `${fitScore}%` }}
              role="progressbar"
              aria-valuenow={fitScore}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button
            variant={selected ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'flex-1 font-semibold',
              selected && 'bg-primary hover:bg-primary-hover text-white',
            )}
            onClick={onSelect}
          >
            {selected ? 'Selecionado' : 'Selecionar'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground gap-1"
            onClick={onViewSource}
            aria-label="Ver fonte do imóvel"
          >
            Ver fonte
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
