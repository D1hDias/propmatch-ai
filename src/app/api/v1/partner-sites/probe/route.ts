import 'server-only';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { apiSuccess, apiError } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

// POST /api/v1/partner-sites/probe
// Body: { url: string }
// Probes a URL and suggests the best discoveryStrategy + detected CPT (for WP).
// Used during partner onboarding to auto-configure new sites.

interface ProbeResult {
  suggestedStrategy: string;
  confidence: 'high' | 'medium' | 'low';
  details: Record<string, unknown>;
}

async function safeFetch(url: string, opts?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...opts,
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; PropMatchBot/1.0)', ...(opts?.headers ?? {}) },
    });
  } catch {
    return null;
  }
}

async function probeUrl(rawUrl: string): Promise<ProbeResult> {
  let base: string;
  try {
    const u = new URL(rawUrl);
    base = u.origin;
  } catch {
    return { suggestedStrategy: 'map_then_scrape', confidence: 'low', details: { error: 'Invalid URL' } };
  }

  // ── 1. WordPress REST API probe ──────────────────────────────────────────
  const wpRoot = await safeFetch(`${base}/wp-json/`);
  if (wpRoot?.ok) {
    const wpData = await wpRoot.json().catch(() => ({})) as Record<string, unknown>;
    const namespace = (wpData.namespaces as string[] | undefined) ?? [];
    if (namespace.includes('wp/v2')) {
      // Probe CPTs: estate, imovel, imoveis, property, properties, imoveldestaque
      const cptCandidates = ['estate', 'imovel', 'imoveis', 'property', 'properties', 'imoveldestaque', 'listing'];
      let detectedCpt = '';
      for (const cpt of cptCandidates) {
        const resp = await safeFetch(`${base}/wp-json/wp/v2/${cpt}?per_page=1`);
        if (resp?.ok) {
          const items = await resp.json().catch(() => []) as unknown[];
          if (Array.isArray(items) && items.length > 0) {
            detectedCpt = cpt;
            break;
          }
        }
      }
      if (detectedCpt) {
        return {
          suggestedStrategy: detectedCpt === 'estate' ? 'wp_rest_api' : `wp_rest_api:${detectedCpt}`,
          confidence: 'high',
          details: { cms: 'WordPress', cpt: detectedCpt, wpNamespaces: namespace },
        };
      }
      // WP site but no structured CPT — use URL scrape fallback
      return {
        suggestedStrategy: 'wp_url_scrape:post',
        confidence: 'medium',
        details: { cms: 'WordPress', cpt: null, hint: 'No real estate CPT detected. Check custom post types in /wp-json/wp/v2/types.' },
      };
    }
  }

  // ── 2. VistaHost probe ───────────────────────────────────────────────────
  for (const path of ['/imoveis/resultado.json?pagina=1', '/imoveis?finalidade=venda&pagina=1', '/api/v1/imoveis?page=1']) {
    const resp = await safeFetch(`${base}${path}`);
    if (resp?.ok) {
      const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
      if (Array.isArray(data.imoveis) || Array.isArray(data.data)) {
        return { suggestedStrategy: 'vistahost_api', confidence: 'high', details: { cms: 'VistaHost', probedPath: path } };
      }
    }
  }

  // ── 3. Sitemidas probe ───────────────────────────────────────────────────
  const sitemidasResp = await safeFetch(`${base}/imoveis/resultado`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
    body: 'tipoNegocio[V]=true&no-pagination=s',
  });
  if (sitemidasResp?.ok) {
    const data = await sitemidasResp.json().catch(() => ({})) as Record<string, unknown>;
    if (Array.isArray(data.imoveis)) {
      return { suggestedStrategy: 'sitemidas_api', confidence: 'high', details: { cms: 'Sitemidas/MidasCRM' } };
    }
  }

  // ── 4. Kenlo probe ───────────────────────────────────────────────────────
  const kenloResp = await safeFetch(`${base}/api/listings?page=1`);
  if (kenloResp?.ok) {
    const data = await kenloResp.json().catch(() => ({})) as Record<string, unknown>;
    if (Array.isArray(data.data) && data.count !== undefined) {
      return { suggestedStrategy: 'kenlo_api', confidence: 'high', details: { cms: 'Kenlo (ex-Imobzi)' } };
    }
  }

  // ── 5. Karioca probe ─────────────────────────────────────────────────────
  const kariocaResp = await safeFetch(`${base}/buscar?finality_id=1&list=1&page=1`);
  if (kariocaResp?.ok) {
    const html = await kariocaResp.text().catch(() => '');
    if (html.includes('/imovel/') && html.includes('finality_id')) {
      return { suggestedStrategy: 'karioca_buscar', confidence: 'high', details: { cms: 'Karioca' } };
    }
  }

  // ── 6. Generic HTML analysis ─────────────────────────────────────────────
  const htmlResp = await safeFetch(base, { headers: { Accept: 'text/html' } });
  const html = htmlResp?.ok ? await htmlResp.text().catch(() => '') : '';

  const needsJs = /window\.__nuxt|window\.__next|<div id="app">|<div id="root">|ng-version/i.test(html);
  const hasSitemap = !!(await safeFetch(`${base}/sitemap.xml`))?.ok;

  return {
    suggestedStrategy: 'map_then_scrape',
    confidence: needsJs ? 'low' : 'medium',
    details: {
      cms: 'Unknown',
      needsJavascript: needsJs,
      hasSitemap,
      hint: needsJs
        ? 'Site appears to use a JS framework (React/Vue/Angular). Set needsJavascript=true and consider map_then_scrape with extended timeout.'
        : 'No known CRM detected. map_then_scrape will use Firecrawl + LLM extraction.',
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = await req.json() as { url?: string };
    if (!body.url || typeof body.url !== 'string') {
      return apiError(new Error('url is required'));
    }
    const result = await probeUrl(body.url);
    return apiSuccess({ data: result });
  } catch (err) {
    return apiError(err);
  }
}
