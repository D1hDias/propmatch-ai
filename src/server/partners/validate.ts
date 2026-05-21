import 'server-only';
import { callLLM } from '@/server/lib/llm';
import { MODELS } from '@/server/lib/models';
import { logger } from '@/server/lib/logger';

export interface SiteValidationResult {
  valid: boolean;
  /** PT-BR message suitable for showing to the broker */
  reason: string;
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Attempts a fetch with a realistic browser User-Agent.
 * Falls back to the HTTP variant when the HTTPS request fails (SSL errors,
 * missing redirect, etc.) so sites that serve only over plain HTTP are still
 * reachable.
 */
async function attemptFetch(url: string): Promise<Response> {
  const opts: RequestInit = {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,*/*' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  };

  try {
    return await fetch(url, opts);
  } catch (firstErr) {
    // If the original URL was HTTPS and it failed, retry with HTTP.
    if (url.startsWith('https://')) {
      const httpUrl = url.replace(/^https:\/\//, 'http://');
      try {
        return await fetch(httpUrl, { ...opts, signal: AbortSignal.timeout(15_000) });
      } catch {
        // Re-throw the original error so the caller sees it.
        throw firstErr;
      }
    }
    throw firstErr;
  }
}

/**
 * Fetches the homepage of a URL and extracts title + meta description +
 * first ~1 500 characters of visible text for classification.
 */
async function fetchHomepageSnippet(url: string): Promise<string> {
  const res = await attemptFetch(url);

  const html = await res.text();

  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1]?.trim() ??
    '';

  // Strip tags and collapse whitespace to get plain text
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500);

  return `Título: ${title}\nDescrição: ${description}\nTexto: ${bodyText}`;
}

/**
 * Returns whether the given URL belongs to a real estate portal or agency.
 * Uses a cheap LLM call on a small homepage snippet — typically < 200ms.
 */
export async function validateRealEstateSite(
  url: string,
): Promise<SiteValidationResult> {
  let snippet: string;
  try {
    snippet = await fetchHomepageSnippet(url);
  } catch (err) {
    logger.warn('partner_validate_fetch_failed', { url, error: String(err) });
    // Network failure (timeout, SSL error, HTTP-only site, etc.) — allow through.
    // The broker knows what site they're adding; the scraper will fail gracefully
    // if the URL is truly unreachable at crawl time.
    return { valid: true, reason: 'Site cadastrado — validação automática indisponível.' };
  }

  const schema = {
    type: 'object',
    properties: {
      valid: { type: 'boolean' },
      reason: { type: 'string' },
    },
    required: ['valid', 'reason'],
    additionalProperties: false,
  };

  try {
    const response = await callLLM({
      model: MODELS.amenityExtraction, // gpt-4.1-nano — fast and cheap for classification
      maxTokens: 120,
      responseSchema: schema,
      system:
        'Você é um classificador de sites. Responda somente com JSON válido conforme o schema.',
      prompt: `Analise o conteúdo abaixo e determine se este site é uma imobiliária, portal de imóveis, agência imobiliária, ou site de anúncios de imóveis (venda ou aluguel de casas, apartamentos, terrenos, salas comerciais, etc).

Retorne:
- "valid": true se for relacionado ao mercado imobiliário, false caso contrário.
- "reason": mensagem curta em português para o usuário (máx 120 caracteres).

Conteúdo do site:
${snippet}`,
      timeoutMs: 10_000,
      maxAttempts: 2,
    });

    const parsed = JSON.parse(response.content[0]!.text) as { valid: boolean; reason: string };
    logger.info('partner_validate_result', { url, valid: parsed.valid, reason: parsed.reason });
    return parsed;
  } catch (err) {
    logger.warn('partner_validate_llm_failed', { url, error: String(err) });
    // On LLM failure, allow the site through — don't block partners due to
    // transient API errors. The scraper will fail gracefully if the site is useless.
    return { valid: true, reason: 'Validação automática indisponível — site cadastrado.' };
  }
}
