import 'server-only';
import { buildCitySlug } from './city-lookup';
import type { SearchCriteria } from './types';

// ---------------------------------------------------------------------------
// URL builder for ZAP Imóveis and VivaReal
//
// City → state mapping is handled by city-lookup.ts (IBGE-backed, all Brazil).
// Neighborhoods are slugified from whatever the user provides — no fixed list.
// ---------------------------------------------------------------------------

const PROPERTY_TYPE_MAP: Record<string, { zap: string; vivareal: string }> = {
  apartment: { zap: 'apartamentos', vivareal: 'apartamento_residencial' },
  house: { zap: 'casas', vivareal: 'casa_residencial' },
  studio: { zap: 'studios-e-kitinetes', vivareal: 'kitnet-studio_residencial' },
  penthouse: { zap: 'coberturas', vivareal: 'cobertura_residencial' },
  commercial: { zap: 'comercial', vivareal: 'loja_comercial' },
  warehouse: { zap: 'galpao-logistico', vivareal: 'galpao_comercial' },
  land: { zap: 'terrenos', vivareal: 'terreno_residencial' },
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildZapUrl(criteria: SearchCriteria): string {
  const citySlug = buildCitySlug(criteria.city, 'zap');
  const typeSlug = PROPERTY_TYPE_MAP[criteria.propertyType ?? 'apartment']?.zap ?? 'apartamentos';
  const transacao = criteria.purpose === 'rent' ? 'aluguel' : 'venda';

  const params = new URLSearchParams();
  // Neighborhood must be a query param — path-based neighborhood slugs return 404 on ZAP
  if (criteria.neighborhood) params.set('bairros', slugify(criteria.neighborhood));
  if (criteria.bedroomsMin) params.set('quartos', String(criteria.bedroomsMin));
  if (criteria.priceMax) params.set('precomaximo', String(criteria.priceMax));
  if (criteria.priceMin) params.set('precominimo', String(criteria.priceMin));
  if (criteria.areaMin) params.set('areaminima', String(criteria.areaMin));

  const base = `https://www.zapimoveis.com.br/${transacao}/${typeSlug}/${citySlug}/`;
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function buildVivaRealUrl(criteria: SearchCriteria): string {
  const citySlug = buildCitySlug(criteria.city, 'vivareal');
  const typeSlug =
    PROPERTY_TYPE_MAP[criteria.propertyType ?? 'apartment']?.vivareal ??
    'apartamento_residencial';
  const transacao = criteria.purpose === 'rent' ? 'aluguel' : 'venda';

  const params = new URLSearchParams();
  // Neighborhood must be a query param — path-based neighborhood slugs return 404 on VivaReal
  if (criteria.neighborhood) params.set('bairros', slugify(criteria.neighborhood));
  if (criteria.bedroomsMin) params.set('quartos', String(criteria.bedroomsMin));
  if (criteria.priceMax) params.set('precoMaximo', String(criteria.priceMax));
  if (criteria.priceMin) params.set('precoMinimo', String(criteria.priceMin));
  if (criteria.areaMin) params.set('areaMinima', String(criteria.areaMin));

  const base = `https://www.vivareal.com.br/${transacao}/${citySlug}/${typeSlug}/`;
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
