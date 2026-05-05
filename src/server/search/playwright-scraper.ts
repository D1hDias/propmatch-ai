import 'server-only';
import { logger } from '@/server/lib/logger';
import { callAnthropic } from '@/server/lib/anthropic';
import type { NormalizedListing, SearchCriteria } from './types';
import { extractAmenities } from './amenity-extractor';

/**
 * Playwright fallback scraper — used when Firecrawl credits are exhausted.
 * Renders the page in a headless browser, extracts the raw HTML/text,
 * then uses Claude Haiku to parse the listings into structured data.
 *
 * NOTE: Playwright is a dev dependency. In production this module is only
 * imported when FIRECRAWL_API_KEY is unset or Firecrawl returns an error.
 */
export async function scrapeWithPlaywright(
  url: string,
  source: 'zap' | 'vivareal',
  criteria: SearchCriteria,
): Promise<NormalizedListing[]> {
  logger.info('playwright scrape start', { url, source });

  // Dynamic import — keeps Playwright out of the main bundle unless needed
  // @playwright/test re-exports chromium for programmatic use
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = require('@playwright/test') as typeof import('@playwright/test');

  const browser = await chromium.launch({ headless: true });
  let pageText = '';

  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    // Wait for listing cards to appear (portal-specific selectors)
    if (source === 'zap') {
      await page.waitForSelector('[data-type="property card"]', { timeout: 10_000 }).catch(() => null);
    } else {
      await page.waitForSelector('[data-type="property"]', { timeout: 10_000 }).catch(() => null);
    }

    // Extract page text — LLM will parse listings from this
    pageText = await page.evaluate(() => document.body.innerText);
  } finally {
    await browser.close();
  }

  if (!pageText || pageText.length < 100) {
    logger.warn('playwright got empty page', { url });
    return [];
  }

  return parsePage(pageText, source, criteria);
}

async function parsePage(
  pageText: string,
  source: 'zap' | 'vivareal',
  criteria: SearchCriteria,
): Promise<NormalizedListing[]> {
  // Trim to fit in context window — keep first 12k chars (covers ~20 listings)
  const truncated = pageText.slice(0, 12_000);

  const systemPrompt = `Você é um parser de anúncios imobiliários brasileiros.
Analise o texto de uma página de busca e retorne um JSON com array "listings".
Cada listing tem: url, title, description, price (número), bedrooms, bathrooms, areaSqm, parkingSpots, neighborhood, address, amenities (array de strings), photos (array vazio se não disponível).
Retorne APENAS JSON válido, sem markdown.`;

  const response = await callAnthropic({
    model: 'claude-haiku-4-5-20251001',
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Fonte: ${source}\nTexto da página:\n${truncated}`,
      },
    ],
    max_tokens: 4096,
  });

  const text = response.content[0]?.text ?? '';
  let parsed: { listings?: unknown[] };
  try {
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(clean) as { listings?: unknown[] };
  } catch {
    logger.warn('playwright LLM parse failed', { source });
    return [];
  }

  const items = parsed.listings ?? [];
  const results: NormalizedListing[] = [];

  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const i = item as Record<string, unknown>;

    const price = Number(i.price ?? 0);
    if (!price) continue;

    const description = String(i.description ?? '');
    const extractedAmenities = await extractAmenities(description);

    let geohash7: string | null = null;
    const lat = typeof i.lat === 'number' ? i.lat : null;
    const lng = typeof i.lng === 'number' ? i.lng : null;
    if (lat && lng) {
      const ngeohash = await import('ngeohash');
      geohash7 = ngeohash.encode(lat, lng, 7);
    }

    results.push({
      source,
      externalId: String(i.url ?? `${source}-${Date.now()}-${results.length}`),
      url: String(i.url ?? ''),
      title: String(i.title ?? ''),
      description,
      photos: Array.isArray(i.photos) ? (i.photos as string[]) : [],
      address: String(i.address ?? ''),
      neighborhood: String(i.neighborhood ?? criteria.neighborhood ?? ''),
      city: criteria.city,
      state: 'SP',
      propertyType: String(i.propertyType ?? criteria.propertyType ?? 'apartment'),
      bedrooms: typeof i.bedrooms === 'number' ? i.bedrooms : null,
      bathrooms: typeof i.bathrooms === 'number' ? i.bathrooms : null,
      areaSqm: typeof i.areaSqm === 'number' ? i.areaSqm : null,
      parkingSpots: typeof i.parkingSpots === 'number' ? i.parkingSpots : null,
      price,
      priceType: criteria.purpose === 'rent' ? 'rent' : 'sale',
      furnished: typeof i.furnished === 'boolean' ? i.furnished : null,
      amenities: Array.isArray(i.amenities) ? (i.amenities as string[]) : [],
      extractedAmenities,
      geohash7,
      lat,
      lng,
      scrapedAt: new Date().toISOString(),
    });
  }

  logger.info('playwright listings parsed', { count: results.length, source });
  return results;
}
