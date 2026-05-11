/**
 * Scraper VPS — internal API
 *
 * Standalone Node/Express service deployed on the dedicated scraper VPS.
 * Receives scrape jobs from the main PropMatch app (portal_x adapter) via
 * POST /scrape authenticated with X-Internal-Key.
 *
 * Deploy: copy this file + package.json to scraper VPS, run with
 *   node --import tsx scraper-api.ts
 * or build to JS first. See infra/systemd/propmatch-scraper.service.
 *
 * Required env vars (set in /etc/propmatch-scraper.env on the VPS):
 *   SCRAPER_INTERNAL_KEY  — must match SCRAPER_VPS_INTERNAL_KEY in main app
 *   PORT                  — defaults to 3100
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { chromium } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT ?? 3100);
const INTERNAL_KEY = process.env.SCRAPER_INTERNAL_KEY ?? '';

if (!INTERNAL_KEY) {
  console.error('FATAL: SCRAPER_INTERNAL_KEY is not set');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function requireInternalKey(req: Request, res: Response, next: NextFunction): void {
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Portal X scraping logic
// ---------------------------------------------------------------------------

interface ScrapeRequest {
  portal: 'portal_x';
  city: string;
  neighborhood?: string | null;
  propertyType?: string | null;
  bedroomsMin?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  areaMin?: number | null;
  purpose: 'buy' | 'rent';
  maxPages: number;
}

interface ScrapedListing {
  externalId: string;
  url: string;
  title: string;
  description: string;
  photos: string[];
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  propertyType: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  parkingSpots: number | null;
  price: number;
  priceType: 'sale' | 'rent';
  furnished: boolean | null;
  amenities: string[];
  lat: number | null;
  lng: number | null;
}

async function scrapePortalX(req: ScrapeRequest): Promise<ScrapedListing[]> {
  // Build search URL for Portal X (placeholder — replace with real URL pattern)
  const base = 'https://www.portalx.com.br';
  const type = req.purpose === 'buy' ? 'comprar' : 'alugar';
  const citySlug = req.city.toLowerCase().replace(/\s+/g, '-');
  const url = `${base}/${type}/${citySlug}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const listings: ScrapedListing[] = [];

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Portal X listing cards — adjust selectors when real portal is confirmed
    const cards = await page.$$('[data-testid="listing-card"]');

    for (const card of cards.slice(0, req.maxPages * 20)) {
      try {
        const externalId = (await card.getAttribute('data-id')) ?? '';
        const href = (await card.$eval('a', (a) => a.href)) ?? '';
        const title = (await card.$eval('[data-testid="title"]', (el) => el.textContent?.trim())) ?? '';
        const priceText = (await card.$eval('[data-testid="price"]', (el) => el.textContent?.trim())) ?? '';
        const price = Number(priceText.replace(/\D/g, '')) || 0;

        if (!externalId || price <= 0) continue;

        listings.push({
          externalId,
          url: href,
          title,
          description: '',
          photos: [],
          address: '',
          neighborhood: req.neighborhood ?? '',
          city: req.city,
          state: '',
          propertyType: req.propertyType ?? 'Apartamento',
          bedrooms: req.bedroomsMin ?? null,
          bathrooms: null,
          areaSqm: null,
          parkingSpots: null,
          price,
          priceType: req.purpose === 'buy' ? 'sale' : 'rent',
          furnished: null,
          amenities: [],
          lat: null,
          lng: null,
        });
      } catch {
        // Skip malformed cards
      }
    }
  } finally {
    await browser.close();
  }

  return listings;
}

// ---------------------------------------------------------------------------
// Route: POST /scrape
// ---------------------------------------------------------------------------

app.post('/scrape', requireInternalKey, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as ScrapeRequest;

  if (!body.portal || !body.city || !body.purpose) {
    res.status(400).json({ error: 'Missing required fields: portal, city, purpose' });
    return;
  }

  if (body.portal !== 'portal_x') {
    res.status(400).json({ error: `Unknown portal: ${body.portal}` });
    return;
  }

  try {
    const listings = await scrapePortalX(body);
    res.json({ listings, scrapedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[scraper] error', err);
    res.status(500).json({ error: 'Scrape failed', detail: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Route: POST /scrape-url  (S11 — generic URL scraping)
// ---------------------------------------------------------------------------

interface ScrapeUrlRequest {
  url: string;
  criteria: {
    city: string;
    purpose: 'buy' | 'rent';
    bedroomsMin?: number | null;
    priceMax?: number | null;
  };
}

interface ExtractedListing {
  externalId: string;
  url: string;
  title: string;
  description: string;
  photos: string[];
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  propertyType: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  parkingSpots: number | null;
  price: number;
  priceType: 'sale' | 'rent';
  furnished: boolean | null;
  amenities: string[];
  lat: number | null;
  lng: number | null;
}

async function scrapeGenericUrl(req: ScrapeUrlRequest): Promise<ExtractedListing[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'pt-BR',
  });

  let pageText = '';
  let pageUrl = req.url;

  try {
    const page = await context.newPage();
    await page.goto(req.url, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    // Wait briefly for JS-rendered content
    await page.waitForTimeout(2000);

    pageUrl = page.url();
    pageText = await page.evaluate(() => document.body.innerText ?? '');
  } finally {
    await browser.close();
  }

  if (!pageText.trim()) return [];

  // Truncate to 12K chars to stay within Claude's context budget
  const truncated = pageText.slice(0, 12_000);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Você é um extrator de dados imobiliários. A seguir está o texto de uma página de imobiliária ou portal.

Extraia TODOS os imóveis listados na página e retorne um JSON array com o seguinte esquema por imóvel:
{
  "externalId": "string único da página (use href ou id da listagem, ou gere um baseado no índice)",
  "url": "URL absoluta do imóvel (se disponível, senão use '${pageUrl}')",
  "title": "título ou nome do imóvel",
  "description": "descrição resumida (máx 300 chars)",
  "photos": [],
  "address": "endereço completo se disponível",
  "neighborhood": "bairro",
  "city": "cidade (use '${req.criteria.city}' se não encontrar)",
  "state": "sigla do estado (ex: SP)",
  "propertyType": "Apartamento | Casa | Studio | Cobertura | Comercial | Terreno",
  "bedrooms": número ou null,
  "bathrooms": número ou null,
  "areaSqm": número em m² ou null,
  "parkingSpots": número ou null,
  "price": número inteiro em reais (sem R$, sem pontos, ex: 850000),
  "priceType": "${req.criteria.purpose === 'buy' ? 'sale' : 'rent'}",
  "furnished": true | false | null,
  "amenities": ["lista de amenidades encontradas"],
  "lat": null,
  "lng": null
}

Retorne APENAS o JSON array, sem texto adicional. Se não houver imóveis, retorne [].

Contexto da busca: ${req.criteria.purpose === 'buy' ? 'venda' : 'aluguel'} em ${req.criteria.city}${req.criteria.bedroomsMin ? `, ${req.criteria.bedroomsMin}+ quartos` : ''}${req.criteria.priceMax ? `, até R$ ${req.criteria.priceMax.toLocaleString('pt-BR')}` : ''}.

Texto da página:
---
${truncated}
---`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0];
  if (!content || content.type !== 'text') return [];

  try {
    // Strip markdown code fences if present
    const json = content.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(json) as ExtractedListing[];
    return Array.isArray(parsed) ? parsed.filter((l) => l.price > 0) : [];
  } catch {
    console.error('[scrape-url] failed to parse Claude response', content.text.slice(0, 200));
    return [];
  }
}

app.post('/scrape-url', requireInternalKey, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as ScrapeUrlRequest;

  if (!body.url || !body.criteria?.city || !body.criteria?.purpose) {
    res.status(400).json({ error: 'Missing required fields: url, criteria.city, criteria.purpose' });
    return;
  }

  try {
    new URL(body.url); // validate URL format
  } catch {
    res.status(400).json({ error: `Invalid URL: ${body.url}` });
    return;
  }

  try {
    const listings = await scrapeGenericUrl(body);
    res.json({ listings, scrapedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[scrape-url] error', err);
    res.status(500).json({ error: 'Scrape failed', detail: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Route: GET /health
// ---------------------------------------------------------------------------

app.get('/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[scraper-api] listening on :${PORT}`);
});
