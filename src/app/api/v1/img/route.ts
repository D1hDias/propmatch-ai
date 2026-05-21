import type { NextRequest } from 'next/server';
import { prisma } from '@/server/db/client';

const CACHE_MAX_AGE = 60 * 60 * 24 * 7; // 7 dias

// Domínios de parceiros em cache — recarrega do banco a cada 5 minutos.
let allowedHostsCache: Set<string> = new Set();
let cacheExpiresAt = 0;

async function isAllowed(url: string): Promise<boolean> {
  try {
    const { hostname } = new URL(url);

    // Rejeita IPs privados / localhost para prevenir SSRF
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
      return false;
    }

    const now = Date.now();
    if (now > cacheExpiresAt) {
      const sites = await prisma.partnerSite.findMany({ select: { domain: true } });
      allowedHostsCache = new Set(sites.map((s) => s.domain.toLowerCase()));
      cacheExpiresAt = now + 5 * 60 * 1000; // 5 minutos
    }

    // Aceita se o hostname bater exatamente com um domínio parceiro
    // ou for subdomínio dele (ex: imgs.kariocaimoveis.com.br)
    return [...allowedHostsCache].some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
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
