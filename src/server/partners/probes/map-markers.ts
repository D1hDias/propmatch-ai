import 'server-only';

const MAP_PROBE_PATHS = [
  '/imoveis/a-venda/',
  '/imoveis/venda/',
  '/imoveis/',
  '/comprar/',
  '/venda/',
  '/imoveis/aluguel/',
  '/alugar/',
];

export async function probeMapMarkers(
  baseUrl: string,
): Promise<{ seedUrls: string[] } | null> {
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
