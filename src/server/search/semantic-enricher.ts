import 'server-only';
import { callLLM } from '@/server/lib/llm';
import { MODELS, MODEL_FALLBACKS } from '@/server/lib/models';
import { logger } from '@/server/lib/logger';
import { trackLLMUsage } from '@/server/lib/usage-tracker';

// ---------------------------------------------------------------------------
// Semantic fields that can only be inferred from free-text descriptions.
// These are NOT available as structured fields from Firecrawl JSON extraction.
// ---------------------------------------------------------------------------

export const SEMANTIC_FIELDS = [
  'dependencia_completa',  // "dependência completa", "dce"
  'reformado',             // "reformado", "renovado", "novo acabamento"
  'precisa_obra',          // "precisa de reforma", "a reformar"
  'andar_alto',            // "andar alto", "visão panorâmica", "último andar"
  'andar_baixo',           // "térreo", "1º andar", "andar baixo"
  'sol_manha',             // "sol da manhã", "nascente", "face leste"
  'sol_tarde',             // "sol da tarde", "poente", "face oeste"
  'sala_ampla',            // "sala ampla", "living"
  'perfil_familiar',       // "família", "crianças"
  'perfil_investidor',     // "renda", "inquilino", "rendimento"
] as const;

export type SemanticField = (typeof SEMANTIC_FIELDS)[number];
export type SemanticEnrichment = Partial<Record<SemanticField, boolean>>;

// ---------------------------------------------------------------------------
// Regex quick-check — avoids LLM call when patterns are unambiguous
// ---------------------------------------------------------------------------

const FIELD_REGEX: Record<SemanticField, RegExp[]> = {
  dependencia_completa: [/\bdependência completa\b/i, /\bDCE\b/, /\bdep\.?\s+completa\b/i],
  reformado: [/\breformad[oa]\b/i, /\brenovad[oa]\b/i, /\bacabamento novo\b/i, /\btotalmente novo\b/i],
  precisa_obra: [/\bprecisa de reforma\b/i, /\ba reformar\b/i, /\bpara reformar\b/i, /\bprecisa reforma\b/i],
  andar_alto: [/\bandar alto\b/i, /\búltimo andar\b/i, /\bcobertura\b/i, /\bvisão panorâmica\b/i, /\bpanoram/i],
  andar_baixo: [/\btérreo\b/i, /\bpavimento térreo\b/i, /\b1[oº°]\s*andar\b/i, /\bandar baixo\b/i],
  sol_manha: [/\bsol da manhã\b/i, /\bnascente\b/i, /\bface leste\b/i, /\boriente\b/i],
  sol_tarde: [/\bsol da tarde\b/i, /\bpoente\b/i, /\bface oeste\b/i, /\bocidente\b/i],
  sala_ampla: [/\bsala ampla\b/i, /\bliving\b/i, /\bsalão\b/i, /\bsala espaçosa\b/i],
  perfil_familiar: [/\bfamília\b/i, /\bcrianças\b/i, /\bfilhos\b/i, /\bescola próxima\b/i],
  perfil_investidor: [/\brenda\b/i, /\binquilino\b/i, /\brendimento\b/i, /\brentabilidade\b/i, /\balugado\b/i],
};

interface QuickCheckResult {
  confident: boolean;
  result: SemanticEnrichment;
}

function quickRegexCheck(description: string, fields: SemanticField[]): QuickCheckResult {
  const result: SemanticEnrichment = {};
  let allConfident = true;

  for (const field of fields) {
    const patterns = FIELD_REGEX[field];
    const matched = patterns.some((p) => p.test(description));
    if (matched) {
      result[field] = true;
    } else {
      // Regex only gives confident negatives when patterns are exhaustive.
      // For fields where absence of keyword means false, trust the regex.
      result[field] = false;
      // Mark as not confident if the description is very short (may be missing context)
      if (description.length < 100) allConfident = false;
    }
  }

  return { confident: allConfident, result };
}

// ---------------------------------------------------------------------------
// LLM enrichment — GPT-4.1 Nano, max 500 chars input
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Você é um analisador de anúncios imobiliários brasileiros.
Analise a descrição e determine quais características semânticas estão PRESENTES.
Responda APENAS com JSON válido, sem markdown. Não invente informação.`;

function buildPrompt(description: string, fields: SemanticField[]): string {
  const fieldDescriptions = fields.map((f) => {
    const descriptions: Record<SemanticField, string> = {
      dependencia_completa: '"dependência completa" ou "DCE"',
      reformado: 'imóvel reformado, renovado ou com acabamento novo',
      precisa_obra: 'imóvel que precisa de reforma',
      andar_alto: 'andar alto, último andar ou cobertura',
      andar_baixo: 'térreo ou primeiro andar',
      sol_manha: 'sol da manhã, nascente ou face leste',
      sol_tarde: 'sol da tarde, poente ou face oeste',
      sala_ampla: 'sala ampla, living ou salão espaçoso',
      perfil_familiar: 'voltado para famílias com crianças',
      perfil_investidor: 'voltado para investidor com renda/rendimento',
    };
    return `"${f}": ${descriptions[f]}`;
  }).join('\n');

  return `Analise a descrição abaixo e retorne JSON com as chaves:\n${fieldDescriptions}\n\nCada chave: true se presente, false se ausente.\n\nDESCRIÇÃO:\n${description.slice(0, 500)}\n\nJSON:`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Enriches a listing description with semantic boolean fields.
 *
 * Called only when the briefing soft_preferences request fields like
 * floor_preference, sun_orientation, or new_or_used — AND the description
 * has enough content (>100 chars) to extract signal from.
 */
export async function enrichSemanticFields(
  description: string,
  fields: SemanticField[],
): Promise<SemanticEnrichment> {
  if (!description || description.length < 50 || fields.length === 0) return {};

  // Fast path: regex check first
  const quick = quickRegexCheck(description, fields);
  if (quick.confident) return quick.result;

  // Slow path: GPT-4.1 Nano
  const start = Date.now();
  try {
    const response = await callLLM({
      model: MODELS.amenityExtraction,
      fallbackModels: MODEL_FALLBACKS.amenityExtraction,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(description, fields),
      maxTokens: 128,
      jsonMode: true,
      // gpt-4.1-nano is ~$0.10/$0.40 per 1M tokens — reject if provider charges more
      maxPrice: { prompt: 0.15, completion: 0.60 },
    });

    trackLLMUsage({
      model: MODELS.amenityExtraction,
      operation: 'semantic_enrichment',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      cachedInputTokens: response.cachedInputTokens,
      durationMs: Date.now() - start,
    });

    const text = response.content.find((c) => c.type === 'text')?.text ?? '{}';
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const enrichment: SemanticEnrichment = {};
    for (const field of fields) {
      if (typeof parsed[field] === 'boolean') {
        enrichment[field] = parsed[field] as boolean;
      }
    }
    return enrichment;
  } catch (err) {
    logger.warn('semantic_enrichment_failed', { error: String(err), descriptionLen: description.length });
    return quick.result;
  }
}

/**
 * Returns which semantic fields are relevant given a briefing's soft_preferences.
 * Only requests enrichment for fields the client actually cares about — saves cost.
 */
export function getRelevantSemanticFields(softPreferences: {
  floor_preference?: string | null;
  sun_orientation?: string | null;
  new_or_used?: string | null;
} | null | undefined): SemanticField[] {
  if (!softPreferences) return [];

  const fields: SemanticField[] = [];

  if (softPreferences.floor_preference === 'high') fields.push('andar_alto');
  if (softPreferences.floor_preference === 'low') fields.push('andar_baixo');
  if (softPreferences.sun_orientation === 'morning') fields.push('sol_manha');
  if (softPreferences.sun_orientation === 'afternoon') fields.push('sol_tarde');
  if (softPreferences.new_or_used === 'new' || softPreferences.new_or_used === 'renovated') {
    fields.push('reformado');
  }
  if (softPreferences.new_or_used === 'needs_work') fields.push('precisa_obra');

  return fields;
}
