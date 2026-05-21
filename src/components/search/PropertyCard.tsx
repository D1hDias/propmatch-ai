'use client';

import Image from 'next/image';
import { useState } from 'react';
import { TrendingUp, ImageOff } from 'lucide-react';

export interface PropertyCardData {
  id: string;
  title: string;
  url: string;
  photos: string[];
  description: string;
  neighborhood: string;
  city: string;
  price: number;
  priceType: 'sale' | 'rent';
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  parkingSpots: number | null;
  furnished: boolean | null;
  amenities: string[];
  extractedAmenities: Record<string, boolean>;
  source: string;
  fitScore?: number;
}

interface PropertyCardProps {
  property: PropertyCardData;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  zap: 'ZAP',
  vivareal: 'VivaReal',
  portal_x: 'Link personalizado',
  custom: 'Link personalizado',
  partner_b: 'Parceiro',
};

const AMENITY_LABELS: Record<string, string> = {
  portaria24h: 'Portaria 24h',
  petFriendly: 'Pet friendly',
  academia: 'Academia',
  piscina: 'Piscina',
  churrasqueira: 'Churrasqueira',
  varanda: 'Varanda',
  varandaGourmet: 'Varanda gourmet',
  areaServico: 'Área de serviço',
  elevador: 'Elevador',
  arCondicionado: 'Ar condicionado',
  acessibilidade: 'Acessibilidade',
};

function SourceFavicon({ url, fallbackLabel }: { url: string; fallbackLabel: string }) {
  const [failed, setFailed] = useState(false);

  let hostname: string | null = null;
  try { hostname = new URL(url).hostname; } catch { /* invalid url */ }

  if (failed || !hostname) {
    return <span className="text-[10px] uppercase tracking-wide text-white">{fallbackLabel}</span>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=16`}
      alt={fallbackLabel}
      title={fallbackLabel}
      width={16}
      height={16}
      className="rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}

function matchColor(score: number): { bg: string; text: string; ring: string } {
  if (score >= 80) return { bg: 'bg-[#4FD66E]', text: 'text-white', ring: 'ring-[#4FD66E]/30' };
  if (score >= 60) return { bg: 'bg-[#FF9F00]', text: 'text-white', ring: 'ring-[#FF9F00]/30' };
  return { bg: 'bg-[#FF5E5E]', text: 'text-white', ring: 'ring-[#FF5E5E]/30' };
}

function formatPrice(price: number, type: 'sale' | 'rent'): string {
  const formatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(price);
  return type === 'rent' ? `${formatted}/mês` : formatted;
}

export function PropertyCardSkeleton() {
  return (
    <article className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="h-36 w-full bg-skeleton animate-pulse" />
      <div className="p-3 space-y-2.5">
        <div className="h-4 w-28 rounded bg-skeleton animate-pulse" />
        <div className="h-3 w-full rounded bg-skeleton animate-pulse" />
        <div className="h-3 w-3/4 rounded bg-skeleton animate-pulse" />
        <div className="flex gap-2 pt-0.5">
          <div className="h-3 w-14 rounded bg-skeleton animate-pulse" />
          <div className="h-3 w-12 rounded bg-skeleton animate-pulse" />
          <div className="h-3 w-10 rounded bg-skeleton animate-pulse" />
        </div>
        <div className="h-3 w-16 rounded bg-skeleton animate-pulse" />
      </div>
    </article>
  );
}

function proxyUrl(url: string): string {
  return `/api/v1/img?url=${encodeURIComponent(url)}`;
}

export function PropertyCard({ property, selected, onToggleSelect }: PropertyCardProps) {
  const rawPhoto = property.photos[0];
  const photo = rawPhoto ? proxyUrl(rawPhoto) : undefined;
  const [photoFailed, setPhotoFailed] = useState(false);
  const highlightedAmenities = Object.entries(property.extractedAmenities)
    .filter(([k, v]) => v && AMENITY_LABELS[k])
    .map(([k]) => AMENITY_LABELS[k]!)
    .slice(0, 2);

  const score = property.fitScore != null ? Math.round(property.fitScore) : null;
  const colors = score != null ? matchColor(score) : null;

  return (
    <article
      className={`card-hover relative rounded-xl border bg-card overflow-hidden ${
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/40'
      }`}
    >
      {/* Selection checkbox — sits above the link layer */}
      {onToggleSelect && (
        <button
          onClick={() => onToggleSelect(property.id)}
          className="absolute top-3 left-3 z-20 h-6 w-6 rounded-md border-2 border-white bg-white/80 backdrop-blur-sm flex items-center justify-center shadow-sm"
          aria-label={selected ? 'Desmarcar imóvel' : 'Selecionar imóvel'}
        >
          {selected && (
            <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      )}

      {/* Match % badge — top right, prominent */}
      {score != null && colors && (
        <div className={`absolute top-3 right-3 z-20 flex items-center gap-1 rounded-full px-2.5 py-1 shadow-md ring-2 ${colors.bg} ${colors.ring}`}>
          <TrendingUp className={`h-3 w-3 ${colors.text}`} />
          <span className={`text-xs font-bold tabular-nums ${colors.text}`}>{score}%</span>
        </div>
      )}

      {/* Entire card body links to the listing — opens in new tab */}
      <a
        href={property.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onClick={(e) => {
          // Don't navigate if user was trying to select the card
          if ((e.target as HTMLElement).closest('button')) e.preventDefault();
        }}
        aria-label={`Abrir ${property.title} no portal`}
      >
        {/* Photo */}
        <div className="relative h-36 w-full bg-muted">
          {photo && !photoFailed ? (
            <Image
              src={photo}
              alt={property.title}
              fill
              className="object-cover"
              unoptimized
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center gap-1.5 text-muted-foreground/40">
              <ImageOff className="h-8 w-8" />
              <span className="text-xs">Sem foto</span>
            </div>
          )}
          {/* Source badge — favicon from Google's free CDN */}
          <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-1 flex items-center gap-1">
            <SourceFavicon url={property.url} fallbackLabel={SOURCE_LABELS[property.source] ?? property.source} />
          </span>
        </div>

        {/* Content */}
        <div className="p-3 space-y-2">
          {/* Price */}
          <p className="text-base font-bold text-foreground">
            {formatPrice(property.price, property.priceType)}
          </p>

          {/* Title / address */}
          <p className="text-xs text-muted-foreground line-clamp-1">{property.title}</p>
          <p className="text-xs text-muted-foreground truncate">{property.neighborhood}, {property.city}</p>

          {/* Specs */}
          <div className="flex gap-2 text-xs text-muted-foreground flex-wrap">
            {property.bedrooms != null && (
              <span>{property.bedrooms} {property.bedrooms === 1 ? 'quarto' : 'quartos'}</span>
            )}
            {property.bathrooms != null && (
              <span>{property.bathrooms} {property.bathrooms === 1 ? 'banheiro' : 'banheiros'}</span>
            )}
            {property.areaSqm != null && <span>{property.areaSqm} m²</span>}
            {property.parkingSpots != null && property.parkingSpots > 0 && (
              <span>{property.parkingSpots} {property.parkingSpots === 1 ? 'vaga' : 'vagas'}</span>
            )}
            {property.furnished === true && <span>Mobiliado</span>}
          </div>

          {/* Extracted amenities badges */}
          {highlightedAmenities.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {highlightedAmenities.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary font-medium"
                >
                  {label}
                </span>
              ))}
            </div>
          )}

          {/* Link hint */}
          <p className="text-[11px] text-primary font-medium">
            Ver no portal →
          </p>
        </div>
      </a>
    </article>
  );
}
