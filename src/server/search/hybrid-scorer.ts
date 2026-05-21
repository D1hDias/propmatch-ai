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
// Lógica de range:
//   priceMin + priceMax definidos → range explícito; dentro do intervalo = 25.
//     (Usuário aceitou conscientemente qualquer valor entre os dois limites.)
//   Só priceMin → penalidade íngreme acima do piso; >20% já é caro, >100% irrelevante.
//   Só priceMax → escala 15-25 abaixo do teto; acima cai rápido.
function scorePreco(l: NormalizedListing, c: SearchCriteria): number {
  const { priceMin, priceMax } = c;
  const price = l.price;

  if (price <= 0) return 15;
  if (!priceMin && !priceMax) return 20;

  // Range explícito (min + max) — tudo dentro do intervalo é ideal
  if (priceMin && priceMax) {
    if (price <= priceMin) return 22;           // abaixo do piso (possível relisting desatualizado)
    if (price <= priceMax) return 25;           // dentro do range = perfeito
    // Acima do teto (hardFilter limita a 1.2×)
    const over = (price - priceMax) / priceMax;
    if (over <= 0.10) return 8;
    return 3;
  }

  // Só priceMin — penalidade íngreme acima do piso
  if (priceMin) {
    if (price <= priceMin) return 25;
    const ratio = price / priceMin;
    if (ratio <= 1.10) return 22;
    if (ratio <= 1.20) return 16;
    if (ratio <= 1.35) return 10;
    if (ratio <= 1.50) return 6;
    if (ratio <= 2.00) return 4;
    return 2;
  }

  // Só priceMax
  if (price <= priceMax!) {
    const ratio = price / priceMax!;
    if (ratio <= 0.7) return 25;
    return Math.round(25 - ((ratio - 0.7) / 0.3) * 10);
  }
  // Acima do teto (hardFilter limita a 1.2×)
  const over = (price - priceMax!) / priceMax!;
  if (over <= 0.10) return 5;
  return 2;
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
// areaMin + areaMax definidos → range explícito; dentro do intervalo = 10.
// Só areaMin → piso ideal; até +10% = perfeito, acima vai reduzindo.
function scoreArea(l: NormalizedListing, c: SearchCriteria): number {
  const { areaMin, areaMax } = c;
  const area = l.areaSqm;
  if (area == null) return 5;

  // Range explícito (min + max) — dentro do intervalo é ideal
  if (areaMin && areaMax) {
    if (area < areaMin) return 0;   // hardFilter deveria ter eliminado
    if (area <= areaMax) return 10; // dentro do range = perfeito
    const ratio = area / areaMax;
    if (ratio <= 1.2) return 7;
    if (ratio <= 1.5) return 5;
    return 3;
  }

  // Só areaMin
  if (!areaMin) return 8;
  if (area < areaMin) return 0;
  const ratio = area / areaMin;
  if (ratio <= 1.1) return 10;
  if (ratio <= 1.3) return 9;
  if (ratio <= 1.6) return 7;
  if (ratio <= 2.0) return 5;
  return 3;
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
