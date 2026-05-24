import type { NextRequest } from 'next/server';

const CACHE_MAX_AGE = 60 * 60 * 24 * 7; // 7 dias

// Bloqueia apenas IPs privados e localhost para prevenir SSRF.
// Não restringimos por domínio porque as fotos vêm de CDNs de sistemas de gestão
// imobiliária (ex: cdn.vistahost.com.br) que não coincidem com o domínio do parceiro.
function isAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Exige HTTPS
    if (parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname;

    // Rejeita IPs privados / localhost para prevenir SSRF
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');

  if (!raw) {
    return new Response('url param required', { status: 400 });
  }

  let url: string;
  try {
    url = decodeURIComponent(raw);
    new URL(url); // validate
  } catch {
    return new Response('invalid url', { status: 400 });
  }

  if (!(await isAllowed(url))) {
    return new Response('host not allowed', { status: 403 });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PropMatchBot/1.0)',
        Accept: 'image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) {
      return new Response('upstream error', { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return new Response('not an image', { status: 502 });
    }

    const body = await upstream.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=86400`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('fetch failed', { status: 502 });
  }
}
