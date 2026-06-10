import 'server-only';
import type { NormalizedListing, SearchCriteria } from './types';

export interface ScoredListing {
  listing: NormalizedListing;
  score: number;
  reason: string;
  breakdown: {
    tipo: number;
    bairro: number;
    preco: number;
    quartos: number;
    area: number;
  };
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Tipo do Imóvel — 25 pts, binário
// Sem dado em algum dos lados → neutro (15). Match = 25, mismatch = 0.
function scoreTipo(l: NormalizedListing, c: SearchCriteria): number {
  if (!c.propertyType || !l.propertyType) return 15;
  return norm(l.propertyType) === norm(c.propertyType) ? 25 : 0;
}

// Bairro — 25 pts, binário
// Sem critério → neutro (20). Bairro desconhecido no listing → benefício da dúvida (12).
// Fora da lista → 0.
function scoreBairro(l: NormalizedListing, c: SearchCriteria): number {
  const candidates = [
    ...(c.neighborhoods ?? []),
    ...(c.neighborhood ? [c.neighborhood] : []),
  ];
  if (candidates.length === 0) return 20;
  if (!l.neighborhood) return 12;
  const lnorm = norm(l.neighborhood);
  const match = candidates.some((n) => {
    const cnorm = norm(n);
    return lnorm.includes(cnorm) || cnorm.includes(lnorm);
  });
  return match ? 25 : 0;
}

// Preço — 25 pts, deslizante
//
// hardFilter já exclui qualquer imóvel fora do range exato (priceMin–priceMax).
// Aqui só chegam imóveis dentro do intervalo → score pleno ou leve gradação abaixo do piso.
function scorePreco(l: NormalizedListing, c: SearchCriteria): number {
  const { priceMin, priceMax } = c;
  const price = l.price;

  if (price <= 0) return 15;
  if (!priceMin && !priceMax) return 20;

  // Range explícito — qualquer valor dentro do intervalo é perfeito
  if (priceMin && priceMax) {
    if (price <= priceMax) return 25;
    return 0; // não deve chegar aqui após hardFilter
  }

  // Só priceMin
  if (priceMin) {
    if (price >= priceMin) return 25;
    return 0; // não deve chegar aqui após hardFilter
  }

  // Só priceMax
  if (price <= priceMax!) {
    const ratio = price / priceMax!;
    if (ratio <= 0.7) return 25;
    return Math.round(25 - ((ratio - 0.7) / 0.3) * 10);
  }
  return 0; // não deve chegar aqui após hardFilter
}

// Quartos — 15 pts, deslizante
// bedroomsMin é o ideal. Exato = 15. Cada quarto a mais = -3 (mín 6).
function scoreQuartos(l: NormalizedListing, c: SearchCriteria): number {
  const { bedroomsMin } = c;
  const beds = l.bedrooms;
  if (beds == null) return 8;
  if (!bedroomsMin) return 12;
  if (beds < bedroomsMin) return 3; // abaixo do mín (hardFilter deveria ter eliminado)
  const over = beds - bedroomsMin;
  return Math.max(6, 15 - over * 3);
}

// Área — 10 pts, deslizante
//
// hardFilter já exclui imóveis fora do range exato (areaMin–areaMax).
// Aqui só chegam imóveis dentro do intervalo → score pleno.
function scoreArea(l: NormalizedListing, c: SearchCriteria): number {
  const { areaMin, areaMax } = c;
  const area = l.areaSqm;
  if (area == null) return 5;

  // Range explícito — dentro do intervalo é perfeito
  if (areaMin && areaMax) {
    if (area < areaMin || area > areaMax) return 0; // não deve chegar aqui após hardFilter
    return 10;
  }

  // Só areaMin
  if (areaMin) {
    if (area < areaMin) return 0; // não deve chegar aqui após hardFilter
    return 10;
  }

  return 8;
}

function buildReason(
  l: NormalizedListing,
  c: SearchCriteria,
  b: ScoredListing['breakdown'],
): string {
  const parts: string[] = [];
  const fmt = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

  if (b.tipo === 0) parts.push('tipo incompatível');
  if (b.bairro === 0) parts.push('bairro fora da área');
  else if (b.bairro === 25 && l.neighborhood) parts.push(`bairro: ${l.neighborhood}`);

  if (l.price > 0) {
    if (b.preco >= 23) parts.push(`preço ótimo (${fmt(l.price)})`);
    else if (b.preco >= 15) parts.push(`preço ok (${fmt(l.price)})`);
    else parts.push(`preço alto (${fmt(l.price)})`);
  }

  if (l.bedrooms != null) {
    const ideal = c.bedroomsMin ?? 0;
    parts.push(l.bedrooms === ideal ? `${l.bedrooms} quartos (ideal)` : `${l.bedrooms} quartos`);
  }

  if (l.areaSqm != null) parts.push(`${l.areaSqm}m²`);

  return parts.join(' · ') || 'Pontuação por critérios';
}

export function hybridScore(l: NormalizedListing, c: SearchCriteria): ScoredListing {
  const breakdown = {
    tipo:    scoreTipo(l, c),
    bairro:  scoreBairro(l, c),
    preco:   scorePreco(l, c),
    quartos: scoreQuartos(l, c),
    area:    scoreArea(l, c),
  };
  const total = breakdown.tipo + breakdown.bairro + breakdown.preco + breakdown.quartos + breakdown.area;
  return {
    listing: l,
    score: Math.min(100, Math.round(total)),
    reason: buildReason(l, c, breakdown),
    breakdown,
  };
}

export function scoreListings(
  listings: NormalizedListing[],
  criteria: SearchCriteria,
  minScore = 40,
): ScoredListing[] {
  return listings
    .map((l) => hybridScore(l, criteria))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score);
}
