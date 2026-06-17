import 'server-only';

export async function probeEgoRealEstate(
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

  if (!html.includes('/DevGear/mainScript.js') && !html.includes('egorealestate.com')) return null;

  const tokenMatch = html.match(/[Aa][Pp][Ii][Tt]oken\s*[=:,]\s*['"]([A-Za-z0-9+/=]{20,})['"]/);
  const authToken = tokenMatch?.[1] ?? '';
  if (!authToken) return null;

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
