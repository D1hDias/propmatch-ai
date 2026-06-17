import 'server-only';

const PROPERTY_CPT_KEYWORDS = [
  'estate', 'imovel', 'imoveis', 'imóvel', 'property', 'properties',
  'listing', 'avulso', 'impacto_imovel', 'realestate', 'real_estate',
];

export async function probeWpRestApi(
  baseUrl: string,
): Promise<{ strategy: string; cpt: string } | null> {
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
