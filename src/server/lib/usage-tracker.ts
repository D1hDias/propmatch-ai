import 'server-only';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Firecrawl credit usage tracking
// ---------------------------------------------------------------------------

export interface FirecrawlUsageEvent {
  operation: 'map' | 'scrape' | 'crawl' | 'batch_scrape' | 'interact';
  domain: string;
  partnerId?: string;
  briefingId?: string;
  urlsProcessed: number;
  creditsUsed?: number;
  durationMs: number;
  listingsFound: number;
}

export function trackFirecrawlUsage(event: FirecrawlUsageEvent): void {
  logger.info('firecrawl_usage', event as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// LLM token usage tracking
// ---------------------------------------------------------------------------

export interface LLMUsageEvent {
  model: string;
  operation: 'briefing_extraction' | 'amenity_extraction' | 'semantic_enrichment';
  briefingId?: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  durationMs: number;
  fallbackUsed?: boolean;
}

export function trackLLMUsage(event: LLMUsageEvent): void {
  logger.info('llm_usage', event as unknown as Record<string, unknown>);
}
