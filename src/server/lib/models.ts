import 'server-only';

// ---------------------------------------------------------------------------
// Central model registry — all LLM calls go through callLLM() in
// llm.ts, which proxies OpenRouter. Change a model here to affect
// every call site that references it.
//
// OpenRouter model IDs: https://openrouter.ai/models
// Format: "provider/model-name"
// ---------------------------------------------------------------------------

export const MODELS = {
  /**
   * Briefing extraction — default model. Strong Portuguese comprehension
   * (slang, abbreviations, price shorthands). json_schema strict supported.
   * Called once per briefing → cost matters less than quality.
   */
  briefingExtraction: 'google/gemini-2.5-flash-lite',

  /**
   * Briefing extraction — fallback. Triggered when the default model returns
   * confidence < 0.65 or is missing critical fields (city, bedrooms, price).
   * GPT-4.1 Mini has reliable structured output and strong instruction-following.
   */
  briefingExtractionFallback: 'openai/gpt-4.1-mini',

  /**
   * Amenity classification and semantic enrichment — reads property description,
   * returns boolean flags for a fixed set of fields. Runs once per scraped
   * listing → cost accumulates fast. GPT-4.1 Nano is OpenRouter's cheapest
   * capable model for this trivial classification task.
   */
  amenityExtraction: 'openai/gpt-4.1-nano',

  /**
   * Listing matcher — cross-references the broker's briefing text with the
   * scraped listings and returns a compatibility score + reason per listing.
   * Gemini Flash is fast, cheap, and handles long JSON payloads well.
   */
  listingMatcher: 'google/gemini-2.5-flash-lite',

  /**
   * Listing data extraction during inventory sync.
   * Reads the markdown of a scraped listing page and returns structured JSON.
   * Runs once per new listing URL — cheapest capable model is appropriate.
   * gpt-4.1-nano: ~$0.10/1M input tokens → ~$0.0003/listing.
   */
  listingSync: 'openai/gpt-4.1-nano',

} as const;

export type ModelKey = keyof typeof MODELS;
