import 'server-only';
import { callLLM } from '@/server/lib/llm';
import { MODELS } from '@/server/lib/models';
import { logger } from '@/server/lib/logger';
import type { NormalizedListing, SearchCriteria } from './types';

// ---------------------------------------------------------------------------
// LLM Matcher — cross-references the broker's briefing text with scraped
// listings using OpenRouter and returns matched listings ranked by fit.
//
// Instead of rigid rule-based scoring, the LLM reads the original briefing
// and each listing's JSON, then assigns a compatibility score (0–100) and
// a short PT-BR reason explaining the match quality.
// ---------------------------------------------------------------------------

export interface MatchedListing {
  listing: NormalizedListing;
  score: number;
  reason: string;
}

const MATCH_RESPONSE_SCHEMA = {
  type: 'object' as const,
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index:  { type: 'number', description: 'Zero-based index of the listing in the input array' },
          score:  { type: 'number', description: 'Compatibility score 0–100' },
          reason: { type: 'string', description: 'One sentence in PT-BR explaining the score' },
        },
        required: ['index', 'score', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Rule-based fallback scorer — used when the LLM call fails.
// Computes a deterministic score (0–100) from hard criteria matching.
// ---------------------------------------------------------------------------

function ruleBasedScore(listing: NormalizedListing, criteria?: SearchCriteria): number {
  if (!criteria) return 50;

  let score = 70; // baseline — passed hardFilter so basic criteria match
  const reasons: string[] = [];

  // Bedrooms: exact match bonus, overshoot penalty
  if (criteria.bedroomsMin != null && listing.bedrooms != null) {
    if (listing.bedrooms === criteria.bedroomsMin) { score += 10; }
    else if (listing.bedrooms > criteria.bedroomsMin + 1) { score -= 5; }
  }

  // Area: bonus for being well within range
  if (criteria.areaMin != null && listing.areaSqm != null) {
    const ratio = listing.areaSqm / criteria.areaMin;
    if (ratio >= 1.0 && ratio <= 1.5) score += 10;
    else if (ratio > 1.5) score += 5;
  }

  // Price: bonus for being close to min (good value), penalty for approaching max
  if (criteria.priceMin != null && listing.price > 0) {
    const ratio = listing.price / criteria.priceMin;
    if (ratio >= 1.0 && ratio <= 1.3) score += 10;
    else if (ratio > 2.0) score -= 10;
  }
  if (criteria.priceMax != null && listing.price > 0) {
    const ratio = listing.price / criteria.priceMax;
    if (ratio > 0.9) score -= 8;
  }

  // Parking
  if (criteria.parkingMin != null && listing.parkingSpots != null) {
    if (listing.parkingSpots >= criteria.parkingMin) score += 5;
  }

  void reasons; // suppress lint
  return Math.min(100, Math.max(0, score));
}

/**
 * Match a list of scraped listings against the original briefing text.
 * Returns listings with score ≥ minScore, sorted descending.
 */
export async function matchListingsToBriefing(
  briefingText: string,
  listings: NormalizedListing[],
  minScore = 40,
  criteria?: SearchCriteria,
): Promise<MatchedListing[]> {
  if (listings.length === 0) return [];

  // Compact JSON representation — only send fields relevant to matching
  const compactListings = listings.map((l, i) => ({
    i,
    tipo: l.propertyType,
    quartos: l.bedrooms,
    banheiros: l.bathrooms,
    area: l.areaSqm,
    vagas: l.parkingSpots,
    preco: l.price,
    bairro: l.neighborhood,
    cidade: l.city,
    titulo: l.title,
    descricao: l.description?.substring(0, 200) || undefined,
  }));

  const systemPrompt = `Você é um assistente especializado em correspondência de imóveis no Brasil.
Dado o texto de um briefing de cliente e uma lista de imóveis em JSON, atribua uma pontuação de compatibilidade (0–100) para cada imóvel.

Critérios de pontuação:
- 90–100: Atende todos os critérios do cliente perfeitamente
- 70–89: Atende os critérios principais com pequenas diferenças
- 50–69: Atende alguns critérios, mas tem diferenças relevantes
- 30–49: Atende poucos critérios
- 0–29: Incompatível com o briefing

Para cada imóvel, retorne o índice (campo "i"), a pontuação e uma frase curta em português explicando o motivo.
Responda APENAS com JSON válido neste formato exato:
{"results":[{"index":0,"score":85,"reason":"Motivo aqui"},{"index":1,"score":72,"reason":"Motivo aqui"}]}`;

  const userPrompt = `BRIEFING DO CLIENTE:
"${briefingText}"

LISTA DE IMÓVEIS:
${JSON.stringify(compactListings, null, 2)}

Avalie a compatibilidade de cada imóvel com o briefing acima.`;

  try {
    const response = await callLLM({
      model: MODELS.listingMatcher,
      system: systemPrompt,
      prompt: userPrompt,
      jsonMode: true,
      maxTokens: 2048,
      timeoutMs: 30000,
    });

    const raw = JSON.parse(response.content[0]?.text ?? '{}') as {
      results?: Array<{ index: number; score: number; reason: string }>;
    };

    const results = raw.results ?? [];

    logger.info('llm_matcher_done', {
      listingsIn: listings.length,
      resultsOut: results.length,
      tokens: response.inputTokens + response.outputTokens,
    });

    return results
      .filter((r) => r.score >= minScore && listings[r.index])
      .map((r) => ({
        listing: listings[r.index]!,
        score: Math.round(r.score),
        reason: r.reason,
      }))
      .sort((a, b) => b.score - a.score);
  } catch (err) {
    logger.warn('llm_matcher_error', { error: String(err) });
    // Fallback: rule-based scoring when LLM is unavailable
    return listings
      .map((listing) => ({ listing, score: ruleBasedScore(listing, criteria), reason: 'Pontuação automática por critérios' }))
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score);
  }
}
