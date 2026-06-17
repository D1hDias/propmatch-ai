import 'server-only';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/lib/logger';
import { getFirecrawl } from './sync-utils';
import type { PartnerSite } from '@prisma/client';
import { probeEgoRealEstate } from './probes/ego-real-estate';
import { probeKenlo } from './probes/kenlo';
import { probeSitemidas } from './probes/sitemidas';
import { probeVistaHost } from './probes/vistahost';
import { probeWpRestApi } from './probes/wp';
import { probeSitemap } from './probes/sitemap';
import { probeMapMarkers } from './probes/map-markers';

// ---------------------------------------------------------------------------
// URL classification — regex-only, no LLM
// ---------------------------------------------------------------------------

const LISTING_PATTERNS = [
  /\/imoveis?\/(a-)?(venda|aluguel|locacao|locação|compra|alugar)/i,
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
              detectedStrategy = wpProbe.strategy;
            }
          }
        }
      }
    }
  }

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
// discoverPartnerSite — Firecrawl MAP + URL classification + probe cascade.
// Called once when a new site is added; result is persisted to avoid re-runs.
// ---------------------------------------------------------------------------

const LOCK_TTL_MS = 10 * 60 * 1000;

export async function discoverPartnerSite(site: PartnerSite): Promise<void> {
  const start = Date.now();

  if (site.discoveryLockedAt && Date.now() - site.discoveryLockedAt.getTime() < LOCK_TTL_MS) {
    logger.warn('partner_discovery_locked', {
      siteId: site.id,
      domain: site.domain,
      lockedSince: site.discoveryLockedAt,
    });
    return;
  }

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
    }

    const classification = classifyUrls(links);

    const seedUrlsUpdate =
      !site.profileLocked &&
      site.seedUrls.length === 0 &&
      classification.candidateSeedUrls.length > 0
        ? { seedUrls: classification.candidateSeedUrls }
        : {};

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
      const isKenlo = await probeKenlo(site.baseUrl);
      if (isKenlo) {
        platformStrategyUpdate = { discoveryStrategy: 'kenlo_api' };
        logger.info('partner_discovery_kenlo_detected', { siteId: site.id, domain: site.domain });
      } else {
        const isSitemidas = await probeSitemidas(site.baseUrl);
        if (isSitemidas) {
          platformStrategyUpdate = { discoveryStrategy: 'sitemidas_api' };
          logger.info('partner_discovery_sitemidas_detected', { siteId: site.id, domain: site.domain });
        } else {
          const isVista = await probeVistaHost(site.baseUrl);
          if (isVista) {
            platformStrategyUpdate = { discoveryStrategy: 'vistahost_api' };
            logger.info('partner_discovery_vistahost_detected', { siteId: site.id, domain: site.domain });
          } else {
            const wpProbe = await probeWpRestApi(site.baseUrl);
            if (wpProbe?.strategy.startsWith('wp_rest_api:')) {
              platformStrategyUpdate = { discoveryStrategy: wpProbe.strategy };
              logger.info('partner_discovery_wp_detected', {
                siteId: site.id, domain: site.domain, strategy: wpProbe.strategy, cpt: wpProbe.cpt,
              });
            } else {
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
                  platformStrategyUpdate = { discoveryStrategy: wpProbe.strategy };
                  logger.info('partner_discovery_wp_detected', {
                    siteId: site.id, domain: site.domain, strategy: wpProbe.strategy, cpt: wpProbe.cpt,
                  });
                }
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
    await prisma.partnerSite.update({
      where: { id: site.id },
      data: { discoveryLockedAt: null },
    }).catch(() => { /* best-effort */ });
    throw err;
  }
}
