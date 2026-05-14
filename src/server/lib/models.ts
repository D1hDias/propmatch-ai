import 'server-only';

// ---------------------------------------------------------------------------
// Central model registry — all LLM calls go through callAnthropic() in
// anthropic.ts, which proxies OpenRouter. Change a model here to affect
// every call site that references it.
//
// OpenRouter model IDs: https://openrouter.ai/models
// Format: "provider/model-name"
// ---------------------------------------------------------------------------

export const MODELS = {
  /**
   * Briefing extraction — converts free-form broker text to structured criteria.
   * Needs strong Portuguese comprehension (slang, abbreviations, price shorthands).
   * Called once per briefing → cost is not a bottleneck, quality matters more.
   * Cost: ~$0.0005 per call (response ≈ 200 tokens).
   */
  briefingExtraction: 'google/gemini-2.5-flash',

  /**
   * Amenity classification — reads property description, returns boolean flags
   * for a fixed set of 26 amenities. Trivial classification task, runs once per
   * scraped listing → cost accumulates fast.
   * Cost: $0.075/$0.30 per M tokens — 15× cheaper than claude-haiku-4.5.
   */
  amenityExtraction: 'google/gemini-2.0-flash-lite-001',

  /**
   * Listing extraction from page markdown — used by Firecrawl scraper to extract
   * structured property data from the markdown of a scraped real estate page.
   * Using our own LLM here (instead of Firecrawl's internal LLM) gives full
   * control over price accuracy and filtering quality.
   * Needs large context (page markdown can be 30–80K tokens).
   */
  listingExtraction: 'google/gemini-2.0-flash-001',

  /**
   * Playwright fallback parser — converts raw page text to structured listings
   * JSON. Only runs when Firecrawl is unavailable/exhausted.
   * Needs 1M context (page text can be large) and good structured extraction.
   */
  playwrightParser: 'google/gemini-2.0-flash-001',
} as const;

export type ModelKey = keyof typeof MODELS;
