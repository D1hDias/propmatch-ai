import 'server-only';
import type { SearchCriteria } from './types';

/**
 * Maps Portuguese city names to ZAP and VivaReal slug formats.
 * Only the most common SP metro area cities covered for MVP.
 */
const CITY_SLUGS: Record<string, { zap: string; vivareal: string }> = {
  'São Paulo': { zap: 'sp+sao-paulo', vivareal: 'sp/sao-paulo' },
  'Guarulhos': { zap: 'sp+guarulhos', vivareal: 'sp/guarulhos' },
  'Campinas': { zap: 'sp+campinas', vivareal: 'sp/campinas' },
  'São Bernardo do Campo': { zap: 'sp+sao-bernardo-do-campo', vivareal: 'sp/sao-bernardo-do-campo' },
  'Santo André': { zap: 'sp+santo-andre', vivareal: 'sp/santo-andre' },
  'Barueri': { zap: 'sp+barueri', vivareal: 'sp/barueri' },
  'Cotia': { zap: 'sp+cotia', vivareal: 'sp/cotia' },
  'Osasco': { zap: 'sp+osasco', vivareal: 'sp/osasco' },
  'Santos': { zap: 'sp+santos', vivareal: 'sp/santos' },
  'Ribeirão Preto': { zap: 'sp+ribeirao-preto', vivareal: 'sp/ribeirao-preto' },
  'Florianópolis': { zap: 'sc+florianopolis', vivareal: 'sc/florianopolis' },
  'Curitiba': { zap: 'pr+curitiba', vivareal: 'pr/curitiba' },
  'Bertioga': { zap: 'sp+bertioga', vivareal: 'sp/bertioga' },
  'Cajamar': { zap: 'sp+cajamar', vivareal: 'sp/cajamar' },
  'Embu das Artes': { zap: 'sp+embu-das-artes', vivareal: 'sp/embu-das-artes' },
};

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
  const citySlug = CITY_SLUGS[criteria.city]?.zap ?? `sp+${slugify(criteria.city)}`;
  const typeSlug = PROPERTY_TYPE_MAP[criteria.propertyType ?? 'apartment']?.zap ?? 'apartamentos';
  const transacao = criteria.purpose === 'rent' ? 'aluguel' : 'venda';

  const params = new URLSearchParams();
  if (criteria.bedroomsMin) params.set('quartos', String(criteria.bedroomsMin));
  if (criteria.priceMax) params.set('precomaximo', String(criteria.priceMax));
  if (criteria.priceMin) params.set('precominimo', String(criteria.priceMin));
  if (criteria.areaMin) params.set('areaminima', String(criteria.areaMin));
  if (criteria.neighborhood) {
    // ZAP encodes neighborhood in the onde param — we append it to city slug
  }

  const base = `https://www.zapimoveis.com.br/${transacao}/${typeSlug}/${citySlug}/`;
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function buildVivaRealUrl(criteria: SearchCriteria): string {
  const citySlug = CITY_SLUGS[criteria.city]?.vivareal ?? `sp/${slugify(criteria.city)}`;
  const typeSlug =
    PROPERTY_TYPE_MAP[criteria.propertyType ?? 'apartment']?.vivareal ??
    'apartamento_residencial';
  const transacao = criteria.purpose === 'rent' ? 'aluguel' : 'venda';

  const neighborhoodSlug = criteria.neighborhood ? `${slugify(criteria.neighborhood)}/` : '';
  const base = `https://www.vivareal.com.br/${transacao}/${citySlug}/${neighborhoodSlug}${typeSlug}/`;

  const params = new URLSearchParams();
  if (criteria.bedroomsMin) params.set('quartos', String(criteria.bedroomsMin));
  if (criteria.priceMax) params.set('precoMaximo', String(criteria.priceMax));
  if (criteria.priceMin) params.set('precoMinimo', String(criteria.priceMin));
  if (criteria.areaMin) params.set('areaMinima', String(criteria.areaMin));

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
