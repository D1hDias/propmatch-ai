import 'server-only';

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

export async function probeSitemap(baseUrl: string): Promise<string | null> {
  const base = baseUrl.replace(/\/$/, '');

  // 1. Direct property-specific sitemap paths (Yoast/RankMath plugins)
  for (const path of PROPERTY_SITEMAP_PATHS) {
    const xml = await fetchXml(`${base}${path}`);
    if (xml && extractLocs(xml).length >= 5) return `${base}${path}`;
  }

  // 2. WordPress 5.5+ native sitemap index (wp-sitemap.xml)
  const wpSitemapXml = await fetchXml(`${base}/wp-sitemap.xml`);
  if (wpSitemapXml) {
    const subSitemaps = extractLocs(wpSitemapXml);
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

    const propertyLocs = locs.filter((u) => PROPERTY_URL_RE.test(u));
    if (propertyLocs.length >= 5) return `${base}/sitemap.xml`;

    const subXmlUrls = locs.filter((u) => u.endsWith('.xml'));
    if (subXmlUrls.length > 0) {
      const ordered = [
        ...subXmlUrls.filter((u) => PROPERTY_URL_RE.test(u)),
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
