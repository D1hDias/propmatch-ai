import 'server-only';

export async function probeSitemidas(baseUrl: string): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, '');
  try {
    const resp = await fetch(`${base}/imoveis/resultado`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      // page=1 instead of no-pagination=s — large sites OOM on the latter
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
