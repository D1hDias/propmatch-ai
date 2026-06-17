import 'server-only';

export async function probeKenlo(baseUrl: string): Promise<boolean> {
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
