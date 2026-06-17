import 'server-only';

export async function probeVistaHost(baseUrl: string): Promise<boolean> {
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
