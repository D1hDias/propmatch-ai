import 'server-only';
import { logger } from '@/server/lib/logger';

// ---------------------------------------------------------------------------
// IBGE-backed city → state (UF) lookup
//
// Fetches all 5571 Brazilian municipalities from the IBGE Localidades API
// and caches them in memory. Re-fetches after CACHE_TTL_MS.
//
// API: https://servicodados.ibge.gov.br/api/v1/localidades/municipios
// ---------------------------------------------------------------------------

interface IbgeMunicipio {
  id: number;
  nome: string;
  microrregiao: {
    mesorregiao: {
      UF: { sigla: string };
    };
  } | null;
  'regiao-imediata'?: {
    'regiao-intermediaria'?: {
      UF?: { sigla: string };
    };
  };
}

const IBGE_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// city name (normalized) → UF abbreviation (uppercase, e.g. "RJ", "SP")
let cache: Map<string, string> | null = null;
let cacheExpiry = 0;
let loadPromise: Promise<void> | null = null;

function normalizeCity(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

// Static fallback for major cities — used when IBGE cache is not loaded or times out.
// Covers the most common inputs for Brazilian real estate searches.
const STATIC_CITY_UF: Record<string, string> = {
  'sao paulo': 'SP',
  'rio de janeiro': 'RJ',
  'belo horizonte': 'MG',
  'curitiba': 'PR',
  'porto alegre': 'RS',
  'salvador': 'BA',
  'fortaleza': 'CE',
  'manaus': 'AM',
  'recife': 'PE',
  'belem': 'PA',
  'goiania': 'GO',
  'guarulhos': 'SP',
  'campinas': 'SP',
  'sao luis': 'MA',
  'maceio': 'AL',
  'natal': 'RN',
  'teresina': 'PI',
  'campo grande': 'MS',
  'joao pessoa': 'PB',
  'aracaju': 'SE',
  'porto velho': 'RO',
  'macapa': 'AP',
  'florianopolis': 'SC',
  'vitoria': 'ES',
  'cuiaba': 'MT',
  'palmas': 'TO',
  'rio branco': 'AC',
  'boa vista': 'RR',
  'sao goncalo': 'RJ',
  'duque de caxias': 'RJ',
  'nova iguacu': 'RJ',
  'niteroi': 'RJ',
  'santos': 'SP',
  'sao bernardo do campo': 'SP',
  'osasco': 'SP',
  'ribeirao preto': 'SP',
  'sorocaba': 'SP',
  'uberlandia': 'MG',
  'londrina': 'PR',
  'joinville': 'SC',
  'juiz de fora': 'MG',
  'contagem': 'MG',
  'feira de santana': 'BA',
};

async function doLoad(): Promise<void> {
  try {
    const res = await fetch(IBGE_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`IBGE API returned ${res.status}`);
    const data = (await res.json()) as IbgeMunicipio[];

    const map = new Map<string, string>();
    for (const m of data) {
      // Primary path: microrregiao → mesorregiao → UF
      // Fallback: regiao-imediata → regiao-intermediaria → UF (for ~1 municipality with null microrregiao)
      const uf =
        m.microrregiao?.mesorregiao?.UF?.sigla ??
        m['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla;

      if (!uf) continue; // skip if no UF found (shouldn't happen)

      const key = normalizeCity(m.nome);
      map.set(key, uf);
    }

    cache = map;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    logger.info('IBGE city cache loaded', { count: map.size });
  } catch (err) {
    logger.warn('IBGE city cache load failed — will retry on next request', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't throw — we have a hardcoded fallback in url-builder.ts
  } finally {
    loadPromise = null;
  }
}

/**
 * Pre-loads the IBGE city cache. Call once at server startup (instrumentation.ts).
 * Idempotent — safe to call multiple times.
 */
export async function preloadCityCache(): Promise<void> {
  if (cache && Date.now() < cacheExpiry) return;
  if (!loadPromise) loadPromise = doLoad();
  await loadPromise;
}

/**
 * Returns the state abbreviation (UF) for a given city name.
 * Normalizes accents and case before looking up.
 *
 * Returns null if the city is not found or the cache hasn't been loaded yet.
 */
export function getCityUF(cityName: string): string | null {
  const key = normalizeCity(cityName);
  // Try IBGE cache first, then static fallback for major cities
  return (cache?.get(key) ?? STATIC_CITY_UF[key]) ?? null;
}

/**
 * Builds the city slug used in ZAP and VivaReal URLs.
 *
 * Format: "{uf}+{city-slug}" for ZAP, "{uf}/{city-slug}" for VivaReal
 * Example: "rj+rio-de-janeiro", "sp/sao-paulo"
 */
export function buildCitySlug(
  cityName: string,
  portal: 'zap' | 'vivareal',
): string {
  const uf = getCityUF(cityName);
  const slug = cityName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  if (!uf) {
    // Fallback: assume São Paulo (most common MVP city)
    logger.warn('city not found in IBGE cache — using sp fallback', { cityName });
    return portal === 'zap' ? `sp+${slug}` : `sp/${slug}`;
  }

  const ufLower = uf.toLowerCase();
  return portal === 'zap' ? `${ufLower}+${slug}` : `${ufLower}/${slug}`;
}
