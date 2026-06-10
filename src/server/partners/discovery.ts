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
      // Use page=1 instead of no-pagination=s — large sites OOM on the latter
      body: 'page=1',
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return false;
    const contentType = resp.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return false;
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
      `${base}/wp-json/wp/v2/${encodeURIComponent(propertyCpt)}?per_page=1&_fields=id,link,meta,property_meta,valor,quartos,metragem`,
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
    // RealHomes plugin stores data in property_meta with REAL_HOMES_property_* keys
    const propertyMeta = item.property_meta;
    const hasRealHomesPrice =
      propertyMeta && typeof propertyMeta === 'object' && !Array.isArray(propertyMeta) &&
      (propertyMeta as Record<string, unknown>)['REAL_HOMES_property_price'] != null &&
      (propertyMeta as Record<string, unknown>)['REAL_HOMES_property_price'] !== '';

    if (hasDirectPrice || hasMetaPrice || hasRealHomesPrice) {
      return { strategy: `wp_rest_api:${propertyCpt}`, cpt: propertyCpt };
    }
    return { strategy: `wp_url_scrape:${propertyCpt}`, cpt: propertyCpt };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// EgoRealEstate (JanelaDigital) probe — detects /DevGear/mainScript.js and
// extracts authorizationtoken + lbl from inline HTML/JS config.
// ---------------------------------------------------------------------------

async function probeEgoRealEstate(
  baseUrl: string,
): Promise<{ authToken: string; lbl: string } | null> {
  const base = baseUrl.replace(/\/$/, '');
  let html = '';
  try {
    const resp = await fetch(base, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PropMatchBot/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    html = await resp.text();
  } catch {
    return null;
  }

  // Must have EgoRealEstate JS bundle to be this platform
  if (!html.includes('/DevGear/mainScript.js') && !html.includes('egorealestate.com')) return null;

  // Extract APIToken (authorizationtoken) — present in inline <script> config
  const tokenMatch = html.match(/[Aa][Pp][Ii][Tt]oken\s*[=:,]\s*['"]([A-Za-z0-9+/=]{20,})['"]/);
  const authToken = tokenMatch?.[1] ?? '';
  if (!authToken) return null;

  // Extract lbl (label/plugin ID) from inline script data attributes or JS config
  const lblMatch =
    html.match(/['"lbl['"]\s*[=:]\s*['"]?(\d{5,})/i) ??
    html.match(/\blbl=(\d{5,})/) ??
    html.match(/data-lbl=["'](\d{5,})["']/);
  const lbl = lblMatch?.[1] ?? '';

  // Confirm API responds successfully with this token
  try {
    const vui = 'probe-00000000-0000-0000-0000-000000000000';
    const params = new URLSearchParams({
      nre: '1', bus: '1', gather_attributes: '0', oar: '1', vui, _: String(Date.now()),
      ...(lbl ? { lbl } : {}),
    });
    const resp = await fetch(`https://websiteapi.egorealestate.com/v1/Properties?${params}`, {
      headers: {
        authorizationtoken: authToken,
        'x-served-by': 'JanelaDigital',
        'x-async': 'true',
        userinfotoken: '',
        accept: 'application/json, text/javascript, */*; q=0.01',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: base,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Linux"',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { Properties?: unknown[] };
    if (!Array.isArray(data.Properties)) return null;
  } catch {
    return null;
  }

  return { authToken, lbl };
}

// ---------------------------------------------------------------------------
// Kenlo (ex-Imobzi) probe — /api/listings?page=1 returns { data: [...] }
// ---------------------------------------------------------------------------

async function probeKenlo(baseUrl: string): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, '');
  try {
    const resp = await fetch(`${base}/api/listings?page=1`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return false;
    const data = (await resp.json()) as Record<string, unknown>;
    return Array.isArray(data.data) && (data.data as unknown[]).length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// VistaHost probe — tries the 4 known Vista Software endpoint patterns
// ---------------------------------------------------------------------------

async function probeVistaHost(baseUrl: string): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, '');
  const candidates = [
    `${base}/imoveis/resultado.json?finalidade=venda&pagina=1`,
    `${base}/imoveis?finalidade=venda&pagina=1`,
    `${base}/api/v1/imoveis?page=1`,
    `${base}/api/imoveis?page=1`,
  ];
  for (const url of candidates) {
    try {
      const resp = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!resp.ok) continue;
      const data = (await resp.json()) as Record<string, unknown>;
      const items = (data.imoveis ?? data.data) as unknown[] | undefined;
      if (Array.isArray(items) && items.length > 0) return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Sitemap probe — checks common Yoast/RankMath/WP property sitemap paths
// Also handles WordPress native sitemap index and generic sitemap indexes.
// ---------------------------------------------------------------------------

const PROPERTY_SITEMAP_PATHS = [
  '/property-sitemap.xml',
  '/imoveis-sitemap.xml',
  '/imovel-sitemap.xml',
  '/post-type-sitemap1.xml',
];

const PROPERTY_URL_RE = /\/(imovel|imoveis|property|properties|listing|anuncio|ficha)\//i;

async function fetchXml(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PropMatchBot/1.0)' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') ?? '';
    // Accept XML or HTML (some sitemaps are served as text/html)
    if (!ct.includes('xml') && !ct.includes('html') && !ct.includes('text')) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

function extractLocs(xml: string): string[] {
  return (xml.match(/<loc>([^<]+)<\/loc>/g) ?? [])
    .map((m) => m.replace(/<\/?loc>/g, '').trim());
}

async function probeSitemap(baseUrl: string): Promise<string | null> {
  const base = baseUrl.replace(/\/$/, '');

  // 1. Direct property-specific sitemap paths (Yoast/RankMath plugins)
  for (const path of PROPERTY_SITEMAP_PATHS) {
    const xml = await fetchXml(`${base}${path}`);
    if (xml && extractLocs(xml).length >= 5) return `${base}${path}`;
  }

  // 2. WordPress 5.5+ native sitemap index (wp-sitemap.xml)
  //    It lists sub-sitemaps per post type: wp-sitemap-posts-property-1.xml
  const wpSitemapXml = await fetchXml(`${base}/wp-sitemap.xml`);
  if (wpSitemapXml) {
    const subSitemaps = extractLocs(wpSitemapXml);
    // Find sub-sitemap for property CPT
    const propertySubSitemap = subSitemaps.find((u) =>
      /posts-(property|imovel|imoveis|listing)/i.test(u),
    );
    if (propertySubSitemap) {
      const subXml = await fetchXml(propertySubSitemap);
      if (subXml && extractLocs(subXml).length >= 3) return propertySubSitemap;
    }
  }

  // 3. Generic sitemap.xml — may be a direct sitemap or a sitemap index
  const mainXml = await fetchXml(`${base}/sitemap.xml`);
  if (mainXml) {
    const locs = extractLocs(mainXml);
    if (locs.length === 0) return null;

    // Case A: direct sitemap with property URLs
    const propertyLocs = locs.filter((u) => PROPERTY_URL_RE.test(u));
    if (propertyLocs.length >= 5) return `${base}/sitemap.xml`;

    // Case B: sitemap index — sub-sitemaps are themselves .xml files
    const subXmlUrls = locs.filter((u) => u.endsWith('.xml'));
    if (subXmlUrls.length > 0) {
      // Prefer sub-sitemaps with property keywords in the URL
      const ordered = [
        ...subXmlUrls.filter((u) => PROPERTY_URL_RE.test(u)),
        // Fallback: pt-BR language sitemap often has the richest property content
        ...subXmlUrls.filter((u) => /pt[-_]br|pt[-_]pt/i.test(u)),
        ...subXmlUrls,
      ];
      for (const subUrl of ordered.slice(0, 4)) {
        const subXml = await fetchXml(subUrl);
        if (!subXml) continue;
        const subLocs = extractLocs(subXml);
        const propLocs = subLocs.filter((u) => PROPERTY_URL_RE.test(u));
        if (propLocs.length >= 5) return subUrl;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// map_markers probe — detects sites that pre-load all listings into JS map variables
// ---------------------------------------------------------------------------

const MAP_PROBE_PATHS = [
  '/imoveis/a-venda/',
  '/imoveis/venda/',
  '/imoveis/',
  '/comprar/',
  '/venda/',
  '/imoveis/aluguel/',
  '/alugar/',
];

async function probeMapMarkers(baseUrl: string): Promise<{ seedUrls: string[] } | null> {
  const base = baseUrl.replace(/\/$/, '');
  const found: string[] = [];
  for (const path of MAP_PROBE_PATHS) {
    try {
      const resp = await fetch(`${base}${path}`, {
        signal: AbortSignal.timeout(12_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PropMatchBot/1.0)' },
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      // Require at least 5 lat/lng pairs — a single map pin doesn't count as an index page.
      const hits = (html.match(/"lat"\s*:\s*-?\d/g) ?? []).length;
      if (hits >= 5) found.push(`${base}${path}`);
    } catch {
      // timeout or network error — skip this path
    }
  }
  return found.length > 0 ? { seedUrls: found } : null;
}

// ---------------------------------------------------------------------------
// autoDetectStrategy — runs all platform probes and persists the result.
//
// Called automatically by syncSite() on the first sync of a site whose
// discoveryStrategy is still null (never probed). After this runs once,
// the saved strategy is reused on every subsequent sync — zero re-probing.
// ---------------------------------------------------------------------------

export async function autoDetectStrategy(
  site: PartnerSite,
): Promise<{ discoveryStrategy: string; seedUrls?: string[] }> {
  logger.info('auto_detect_strategy_start', { siteId: site.id, domain: site.domain });

  let detectedStrategy = 'map_then_scrape';
  let detectedSeedUrls: string[] | undefined;

  // Probe in priority order: fastest/cheapest first, Firecrawl-based last.
  const egoProbe = await probeEgoRealEstate(site.baseUrl);
  if (egoProbe) {
    detectedStrategy = 'egorealestate_api';
    await prisma.partnerSite.update({
      where: { id: site.id },
      data: {
        discoveryStrategy: 'egorealestate_api',
        searchConfig: { authToken: egoProbe.authToken, lbl: egoProbe.lbl, bus: ['1', '2'] },
        lastDiscoveredAt: new Date(),
      },
    });
    logger.info('auto_detect_strategy_done', { siteId: site.id, domain: site.domain, strategy: 'egorealestate_api' });
    return { discoveryStrategy: 'egorealestate_api' };
  }

  const isKenlo = await probeKenlo(site.baseUrl);
  if (isKenlo) {
    detectedStrategy = 'kenlo_api';
  } else {
    const isSitemidas = await probeSitemidas(site.baseUrl);
    if (isSitemidas) {
      detectedStrategy = 'sitemidas_api';
    } else {
      const isVista = await probeVistaHost(site.baseUrl);
      if (isVista) {
        detectedStrategy = 'vistahost_api';
      } else {
        const wpProbe = await probeWpRestApi(site.baseUrl);
        if (wpProbe?.strategy.startsWith('wp_rest_api:')) {
          detectedStrategy = wpProbe.strategy;
        } else {
          const sitemapUrl = await probeSitemap(site.baseUrl);
          if (sitemapUrl) {
            detectedStrategy = 'sitemap_scrape';
            if (site.seedUrls.length === 0) detectedSeedUrls = [sitemapUrl];
          } else {
            const mapProbe = await probeMapMarkers(site.baseUrl);
            if (mapProbe) {
              detectedStrategy = 'map_markers';
              if (site.seedUrls.length === 0) detectedSeedUrls = mapProbe.seedUrls;
            } else if (wpProbe) {
              // WP CPT found but no structured data — per-page Firecrawl scrape
              detectedStrategy = wpProbe.strategy;
            }
            // else: stays 'map_then_scrape'
          }
        }
      }
    }
  }

  // Persist immediately so the next sync skips detection entirely.
  await prisma.partnerSite.update({
    where: { id: site.id },
    data: {
      discoveryStrategy: detectedStrategy,
      ...(detectedSeedUrls && site.seedUrls.length === 0 ? { seedUrls: detectedSeedUrls } : {}),
      lastDiscoveredAt: new Date(),
    },
  });

  logger.info('auto_detect_strategy_done', {
    siteId: site.id,
    domain: site.domain,
    strategy: detectedStrategy,
    seedUrls: detectedSeedUrls,
  });

  return {
    discoveryStrategy: detectedStrategy,
    ...(detectedSeedUrls ? { seedUrls: detectedSeedUrls } : {}),
  };
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
      site.discoveryStrategy === 'map_markers' ||
      site.discoveryStrategy === 'sitemap_scrape' ||
      site.discoveryStrategy === 'kenlo_api' ||
      site.discoveryStrategy === 'karioca_buscar' ||
      site.discoveryStrategy === 'vistahost_api' ||
      site.discoveryStrategy === 'egorealestate_api' ||
      site.discoveryStrategy?.startsWith('wp_rest_api:') ||
      site.discoveryStrategy?.startsWith('wp_url_scrape:') ||
      site.discoveryStrategy === 'wp_rest_api';

    let platformStrategyUpdate: Record<string, unknown> = {};
    if (!strategyAlreadySet) {
      // Probe order: fastest zero-credit APIs first, then sitemap, then JS markers, then fallback.

      // 1. Kenlo (ex-Imobzi) — /api/listings JSON, fastest check
      const isKenlo = await probeKenlo(site.baseUrl);
      if (isKenlo) {
        platformStrategyUpdate = { discoveryStrategy: 'kenlo_api' };
        logger.info('partner_discovery_kenlo_detected', { siteId: site.id, domain: site.domain });
      } else {
        // 2. Sitemidas (MidasCRM Angular SPA)
        const isSitemidas = await probeSitemidas(site.baseUrl);
        if (isSitemidas) {
          platformStrategyUpdate = { discoveryStrategy: 'sitemidas_api' };
          logger.info('partner_discovery_sitemidas_detected', { siteId: site.id, domain: site.domain });
        } else {
          // 3. VistaHost (Vista Software CMS — 4 endpoint variants)
          const isVista = await probeVistaHost(site.baseUrl);
          if (isVista) {
            platformStrategyUpdate = { discoveryStrategy: 'vistahost_api' };
            logger.info('partner_discovery_vistahost_detected', { siteId: site.id, domain: site.domain });
          } else {
            // 4. WordPress REST API — detects structured data (direct, meta, RealHomes plugin)
            const wpProbe = await probeWpRestApi(site.baseUrl);
            if (wpProbe?.strategy.startsWith('wp_rest_api:')) {
              platformStrategyUpdate = { discoveryStrategy: wpProbe.strategy };
              logger.info('partner_discovery_wp_detected', {
                siteId: site.id, domain: site.domain, strategy: wpProbe.strategy, cpt: wpProbe.cpt,
              });
            } else {
              // 5. Sitemap XML (Yoast/RankMath) — 1 free request, faster than per-page Firecrawl
              const sitemapUrl = await probeSitemap(site.baseUrl);
              if (sitemapUrl) {
                platformStrategyUpdate = {
                  discoveryStrategy: 'sitemap_scrape',
                  ...(site.seedUrls.length === 0 ? { seedUrls: [sitemapUrl] } : {}),
                };
                logger.info('partner_discovery_sitemap_detected', {
                  siteId: site.id, domain: site.domain, sitemapUrl,
                });
              } else {
                // 6. JS map markers (lat/lng pre-loaded in page HTML)
                const mapProbe = await probeMapMarkers(site.baseUrl);
                if (mapProbe) {
                  platformStrategyUpdate = {
                    discoveryStrategy: 'map_markers',
                    ...(site.seedUrls.length === 0 ? { seedUrls: mapProbe.seedUrls } : {}),
                  };
                  logger.info('partner_discovery_map_markers_detected', {
                    siteId: site.id, domain: site.domain, seedUrls: mapProbe.seedUrls,
                  });
                } else if (wpProbe) {
                  // 7. WP with CPT but no structured data and no sitemap — per-page Firecrawl
                  platformStrategyUpdate = { discoveryStrategy: wpProbe.strategy };
                  logger.info('partner_discovery_wp_detected', {
                    siteId: site.id, domain: site.domain, strategy: wpProbe.strategy, cpt: wpProbe.cpt,
                  });
                }
                // else: map_then_scrape fallback (syncSite default when discoveryStrategy is null)
              }
            }
          }
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
