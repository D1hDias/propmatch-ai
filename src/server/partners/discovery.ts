import 'server-only';
import FirecrawlApp from '@mendable/firecrawl-js';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';
import type { PartnerSite } from '@prisma/client';

let _firecrawl: FirecrawlApp | null = null;

function getFirecrawl(): FirecrawlApp {
  if (!_firecrawl) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY env var is not set');
    _firecrawl = new FirecrawlApp({ apiKey, apiUrl: process.env.FIRECRAWL_API_URL });
  }
  return _firecrawl;
}

// ---------------------------------------------------------------------------
// URL classification — regex-only, no LLM
// ---------------------------------------------------------------------------

const LISTING_PATTERNS = [
  // Padrão direto: /imoveis/venda, /imoveis/aluguel, /imoveis/a-venda, etc.
  /\/imoveis?\/(a-)?(venda|aluguel|locacao|locação|compra|alugar)/i,
  // Página raiz de listagem com subpath de finalidade
  /\/(venda|aluguel|locacao|para-alugar|para-venda)(\?|$|\/)/i,
  /\/busca(\?|$|\/)/i,
  /\/search(\?|$|\/)/i,
  /\/resultados(\?|$|\/)/i,
  /\/lista(\?|$|\/)/i,
  /\/(finalidade|tipo|quartos|preco|bairro|cidade)=/i,
  /\/(apartamentos|casas|studios|imoveis)(-para-)?-(venda|aluguel)/i,
];

const PROPERTY_PATTERNS = [
  /\/imovel\/[a-z0-9-]{5,}/i,
  /\/imovel\/\d{4,}/i,
  /\/anuncio\/[a-z0-9-]{5,}/i,
  /\/detalhe\/[a-z0-9-]{5,}/i,
  /\/detail\/[a-z0-9-]{5,}/i,
  /\/property\/[a-z0-9-]{5,}/i,
  /\/ficha\/[a-z0-9-]{5,}/i,
  /-id-\d{4,}/i,
  /\/(ap|casa|studio|terreno)-[a-z0-9-]{10,}/i,
];

const DYNAMIC_SITE_HINTS = [
  /#\/imoveis/i,
  /\?_escaped_fragment_/i,
  /\/app\//i,
];

interface Classification {
  propertyUrlPatterns: string[];
  listingUrlPatterns: string[];
  // Full URLs of listing/index pages discovered — used to populate seedUrls
  candidateSeedUrls: string[];
  includePaths: string[];
  usesSitemap: boolean;
  needsInteract: boolean;
}

function classifyUrls(links: string[]): Classification {
  const listingSet = new Set<string>();
  const propertySet = new Set<string>();
  const seedCandidates = new Set<string>();
  let hasXml = false;

  for (const link of links) {
    if (link.endsWith('.xml') || link.includes('sitemap')) {
      hasXml = true;
      continue;
    }
    try {
      const parsed = new URL(link);
      const path = parsed.pathname;

      if (PROPERTY_PATTERNS.some((p) => p.test(path))) {
        const match = path.match(/^(\/[^/]+\/)/);
        if (match) propertySet.add(match[1]!);
      } else if (LISTING_PATTERNS.some((p) => p.test(path + parsed.search))) {
        const match = path.match(/^(\/[^/]+\/)/);
        if (match) listingSet.add(match[1]!);
        // Keep the full URL as a seed candidate (strip query string for cleanliness)
        seedCandidates.add(`${parsed.origin}${parsed.pathname}`);
      }
    } catch {
      // ignore malformed URLs
    }
  }

  const needsInteract = links.some((l) => DYNAMIC_SITE_HINTS.some((p) => p.test(l)));
  const includePaths = [...new Set([...listingSet, ...propertySet])];

  return {
    propertyUrlPatterns: [...propertySet],
    listingUrlPatterns: [...listingSet],
    candidateSeedUrls: [...seedCandidates],
    includePaths,
    usesSitemap: hasXml,
    needsInteract,
  };
}

// ---------------------------------------------------------------------------
// Sitemidas/MidasCRM probe — detect Angular SPA platform
// ---------------------------------------------------------------------------

async function probeSitemidas(baseUrl: string): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, '');
  try {
    const resp = await fetch(`${base}/imoveis/resultado`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'tipoNegocio[V]=true&no-pagination=s',
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return false;
    const data = (await resp.json()) as Record<string, unknown>;
    return Array.isArray(data.imoveis);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// WordPress REST API probe — auto-detect CPT and field mode
// ---------------------------------------------------------------------------

const PROPERTY_CPT_KEYWORDS = [
  'estate', 'imovel', 'imoveis', 'imóvel', 'property', 'properties',
  'listing', 'avulso', 'impacto_imovel', 'realestate', 'real_estate',
];

async function probeWpRestApi(baseUrl: string): Promise<{ strategy: string; cpt: string } | null> {
  const base = baseUrl.replace(/\/$/, '');
  try {
    const typesResp = await fetch(`${base}/wp-json/wp/v2/types`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!typesResp.ok) return null;

    const types = (await typesResp.json()) as Record<string, { rest_base?: string }>;
    let propertyCpt: string | null = null;
    for (const typeDef of Object.values(types)) {
      const rb = (typeDef.rest_base ?? '').toLowerCase();
      if (PROPERTY_CPT_KEYWORDS.some((kw) => rb.includes(kw))) {
        propertyCpt = typeDef.rest_base!;
        break;
      }
    }
    if (!propertyCpt) return null;

    // Sample first item to determine whether fields are structured or URL-only
    const sampleResp = await fetch(
      `${base}/wp-json/wp/v2/${encodeURIComponent(propertyCpt)}?per_page=1&_fields=id,link,meta,valor,quartos,metragem`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
    );
    if (!sampleResp.ok) return null;

    const items = (await sampleResp.json()) as Record<string, unknown>[];
    if (!items.length) return null;

    const item = items[0]!;
    const hasDirectPrice = ['valor', 'preco', 'price', 'valor_venda'].some(
      (f) => item[f] !== undefined && item[f] !== null && item[f] !== '' && Number(item[f]) > 0,
    );
    const meta = item.meta;
    const hasMetaPrice =
      meta && typeof meta === 'object' && !Array.isArray(meta) &&
      Object.keys(meta as object).some((k) =>
        ['valor_venda', 'valor_aluguel', 'valor', 'preco', 'price'].some((pp) =>
          k.toLowerCase().includes(pp) &&
          (meta as Record<string, unknown>)[k] !== undefined &&
          (meta as Record<string, unknown>)[k] !== null &&
          (meta as Record<string, unknown>)[k] !== '',
        ),
      );

    if (hasDirectPrice || hasMetaPrice) {
      return { strategy: `wp_rest_api:${propertyCpt}`, cpt: propertyCpt };
    }
    return { strategy: `wp_url_scrape:${propertyCpt}`, cpt: propertyCpt };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Discovery lock TTL — prevents concurrent runs on the same site
// ---------------------------------------------------------------------------

const LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Main discovery function
// ---------------------------------------------------------------------------

export async function discoverPartnerSite(site: PartnerSite): Promise<void> {
  const start = Date.now();

  // Idempotency: skip if a discovery run is already in progress for this site.
  if (site.discoveryLockedAt && Date.now() - site.discoveryLockedAt.getTime() < LOCK_TTL_MS) {
    logger.warn('partner_discovery_locked', {
      siteId: site.id,
      domain: site.domain,
      lockedSince: site.discoveryLockedAt,
    });
    return;
  }

  // Acquire lock before doing any network work.
  await prisma.partnerSite.update({
    where: { id: site.id },
    data: { discoveryLockedAt: new Date() },
  });

  const firecrawl = getFirecrawl();
  logger.info('partner_discovery_start', { siteId: site.id, domain: site.domain });

  try {
    let links: string[] = [];
    try {
      const result = await firecrawl.map(site.baseUrl, { limit: 200, includeSubdomains: true });
      links = (result.links ?? []).map((l) => (typeof l === 'string' ? l : l.url)).filter(Boolean);
    } catch (err) {
      logger.warn('partner_discovery_map_failed', {
        siteId: site.id,
        domain: site.domain,
        error: String(err),
      });
      // Still update lastDiscoveredAt so we don't retry immediately.
    }

    const classification = classifyUrls(links);

    // When profileLocked = true the broker has manually configured URL patterns.
    // We honour their config and only update the discovery timestamp.
    //
    // seedUrls: only populate when currently empty — never overwrite a manually
    // configured set, since those are calibrated and ordering matters for priceType.
    const seedUrlsUpdate =
      !site.profileLocked &&
      site.seedUrls.length === 0 &&
      classification.candidateSeedUrls.length > 0
        ? { seedUrls: classification.candidateSeedUrls }
        : {};

    // Probe platform — only when profile is not locked and strategy not yet set.
    const strategyAlreadySet =
      site.profileLocked ||
      site.discoveryStrategy === 'sitemidas_api' ||
      site.discoveryStrategy?.startsWith('wp_rest_api:') ||
      site.discoveryStrategy?.startsWith('wp_url_scrape:') ||
      site.discoveryStrategy === 'wp_rest_api';

    let platformStrategyUpdate: Record<string, string> = {};
    if (!strategyAlreadySet) {
      // 1. Probe Sitemidas (Angular SPA with hidden JSON endpoint) — fast, cheap.
      const isSitemidas = await probeSitemidas(site.baseUrl);
      if (isSitemidas) {
        platformStrategyUpdate = { discoveryStrategy: 'sitemidas_api' };
        logger.info('partner_discovery_sitemidas_detected', {
          siteId: site.id,
          domain: site.domain,
        });
      } else {
        // 2. Probe WordPress REST API.
        const wpProbe = await probeWpRestApi(site.baseUrl);
        if (wpProbe) {
          platformStrategyUpdate = { discoveryStrategy: wpProbe.strategy };
          logger.info('partner_discovery_wp_detected', {
            siteId: site.id,
            domain: site.domain,
            strategy: wpProbe.strategy,
            cpt: wpProbe.cpt,
          });
        }
      }
    }

    const patternUpdate = site.profileLocked
      ? {}
      : {
          propertyUrlPatterns: classification.propertyUrlPatterns,
          listingUrlPatterns: classification.listingUrlPatterns,
          includePaths: classification.includePaths,
          usesSitemap: classification.usesSitemap,
          needsInteract: classification.needsInteract,
          ...seedUrlsUpdate,
          ...platformStrategyUpdate,
        };

    await prisma.partnerSite.update({
      where: { id: site.id },
      data: {
        ...patternUpdate,
        lastDiscoveredAt: new Date(),
        discoveryLockedAt: null,
      },
    });

    logger.info('partner_discovery_complete', {
      siteId: site.id,
      domain: site.domain,
      profileLocked: site.profileLocked,
      linksFound: links.length,
      propertyPatterns: classification.propertyUrlPatterns.length,
      listingPatterns: classification.listingUrlPatterns.length,
      needsInteract: classification.needsInteract,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    // Release lock even on unexpected errors so the site can be retried.
    await prisma.partnerSite.update({
      where: { id: site.id },
      data: { discoveryLockedAt: null },
    }).catch(() => { /* best-effort */ });
    throw err;
  }
}
