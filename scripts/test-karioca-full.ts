/**
 * Teste end-to-end do pipeline de scraping para kariocaimoveis.com.br.
 *
 * Camadas testadas:
 *   1. HTML scraper (sem headless, sem Firecrawl — roda sempre)
 *   2. Firecrawl MAP   (requer túnel SSH: ssh -N -L 3004:localhost:3004 root@31.97.245.82)
 *   3. Firecrawl SCRAPE de página de busca (requer túnel)
 *   4. Firecrawl SCRAPE de imóvel individual (requer túnel)
 *
 * Como rodar:
 *   pnpm dotenv -e .env.local -- tsx scripts/test-karioca-full.ts
 *
 * Para usar o Firecrawl self-hosted, o túnel deve estar ativo E o .env.local deve ter:
 *   FIRECRAWL_API_KEY=propmatch-local-key
 *   FIRECRAWL_API_URL=http://localhost:3004
 */

// ─── Bootstrap: mock server-only so this script runs outside Next.js ──────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./mock-server-only.cjs');

import FirecrawlApp from '@mendable/firecrawl-js';

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://kariocaimoveis.com.br';
const SEARCH_PAGE = `${BASE_URL}/imoveis/a-venda`;
const SAMPLE_LISTING = `${BASE_URL}/imovel/apartamento-2-quartos-flamengo/KR298562`;
const LISTING_PATTERNS = ['/imovel/', '/casa-em-condominio/'];

const FC_API_KEY = process.env.FIRECRAWL_API_KEY;
const FC_API_URL = process.env.FIRECRAWL_API_URL;   // undefined → uses cloud

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sep(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); }
function fail(msg: string) { console.log(`  ❌ ${msg}`); }
function info(msg: string) { console.log(`  ℹ️  ${msg}`); }

async function withTimer<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const result = await fn();
  console.log(`     ⏱  ${label}: ${Date.now() - t}ms`);
  return result;
}

// ─── Layer 1: HTML scraper ────────────────────────────────────────────────────

async function testHtmlScraper() {
  sep('LAYER 1 — HTML scraper (sem Firecrawl)');

  const { scrapeHtmlListings } = await import('../src/server/search/html-scraper');

  const criteria = {
    city: 'Rio de Janeiro',
    purpose: 'buy' as const,
    bedroomsMin: null, bedroomsMax: null,
    priceMin: null, priceMax: null,
    areaMin: null, neighborhood: null, propertyType: null,
  };

  let listings: Awaited<ReturnType<typeof scrapeHtmlListings>>;
  try {
    listings = await withTimer('html scrape /imoveis/a-venda', () =>
      scrapeHtmlListings(SEARCH_PAGE, criteria),
    );
  } catch (err) {
    fail(`HTML scraper lançou exceção: ${err}`);
    return;
  }

  if (listings.length === 0) {
    fail('Nenhum imóvel retornado — verifique o scraper ou a estrutura do site');
    return;
  }

  ok(`${listings.length} imóveis extraídos`);

  // Breakdown por tipo
  const vendaCount  = listings.filter((l) => l.priceType === 'sale').length;
  const aluguelCount = listings.filter((l) => l.priceType === 'rent').length;
  info(`priceType sale=${vendaCount} rent=${aluguelCount}`);

  // Verifica se o bug de listingType foi corrigido
  const wrongType = listings.filter((l) => l.priceType === 'rent');
  if (wrongType.length > listings.length * 0.5) {
    warn(`Mais de 50% classificados como aluguel num scrape de página de venda — verificar bug de listingType`);
  }

  // Campos preenchidos
  const withPrice   = listings.filter((l) => l.price > 0).length;
  const withBeds    = listings.filter((l) => l.bedrooms != null).length;
  const withArea    = listings.filter((l) => l.areaSqm != null).length;
  const withNeigh   = listings.filter((l) => l.neighborhood).length;
  info(`price=${withPrice}/${listings.length}  beds=${withBeds}  area=${withArea}  bairro=${withNeigh}`);

  // 3 amostras
  console.log('\n  Amostras:');
  for (const l of listings.slice(0, 3)) {
    console.log(`    • ${l.title.slice(0, 60)}`);
    console.log(`      R$ ${l.price.toLocaleString('pt-BR')} | ${l.bedrooms ?? '?'}q | ${l.areaSqm ?? '?'}m² | ${l.neighborhood || '?'}`);
    console.log(`      ${l.url}`);
  }

  // Aluguel test
  sep('LAYER 1b — HTML scraper página de aluguel');
  const rentCriteria = { ...criteria, purpose: 'rent' as const };
  let rentListings: Awaited<ReturnType<typeof scrapeHtmlListings>>;
  try {
    rentListings = await withTimer('html scrape /imoveis/aluguel', () =>
      scrapeHtmlListings(`${BASE_URL}/imoveis/aluguel`, rentCriteria),
    );
    ok(`${rentListings.length} imóveis de aluguel extraídos`);
    const rentTypeOk = rentListings.filter((l) => l.priceType === 'rent').length;
    info(`Todos com priceType=rent: ${rentTypeOk}/${rentListings.length}`);
  } catch (err) {
    warn(`Página de aluguel falhou (pode não existir): ${err}`);
  }
}

// ─── Layer 2: Firecrawl MAP ───────────────────────────────────────────────────

async function testFirecrawlMap(fc: FirecrawlApp) {
  sep('LAYER 2 — Firecrawl MAP (descoberta de URLs)');

  let mapResult: Awaited<ReturnType<typeof fc.map>>;
  try {
    mapResult = await withTimer('MAP kariocaimoveis.com.br', () =>
      fc.map(BASE_URL, { limit: 5000 }),
    );
  } catch (err) {
    fail(`MAP falhou: ${err}`);
    return;
  }

  const allLinks = (mapResult.links ?? []).map((e) =>
    typeof e === 'string' ? e : (e as { url: string }).url,
  );

  const listingUrls = [...new Set(
    allLinks.filter((u) => LISTING_PATTERNS.some((p) => u.includes(p))),
  )];

  ok(`${allLinks.length} links totais → ${listingUrls.length} URLs de imóveis`);
  info(`Primeiras 5: ${listingUrls.slice(0, 5).join(' | ')}`);

  // XMLs (sitemap)
  const xmlUrls = allLinks.filter((u) => /\.xml(\?|$)/i.test(u));
  if (xmlUrls.length > 0) {
    info(`Sitemaps XML encontrados: ${xmlUrls.join(' | ')}`);
  }

  return listingUrls;
}

// ─── Layer 3: Firecrawl SCRAPE de busca ───────────────────────────────────────

async function testFirecrawlSearchScrape(fc: FirecrawlApp) {
  sep('LAYER 3 — Firecrawl SCRAPE (página de busca)');

  const { scrapeWithFirecrawl } = await import('../src/server/search/firecrawl-scraper');

  const criteria = {
    city: 'Rio de Janeiro',
    purpose: 'buy' as const,
    bedroomsMin: null, bedroomsMax: null,
    priceMin: null, priceMax: null,
    areaMin: null, neighborhood: null, propertyType: null,
  };

  let listings: Awaited<ReturnType<typeof scrapeWithFirecrawl>>;
  try {
    listings = await withTimer('Firecrawl scrape /imoveis/a-venda', () =>
      scrapeWithFirecrawl(SEARCH_PAGE, 'vivareal', criteria),
    );
  } catch (err) {
    fail(`Scrape falhou: ${err}`);
    return;
  }

  ok(`${listings.length} imóveis extraídos via Firecrawl`);

  const withPrice = listings.filter((l) => l.price > 0).length;
  const withBeds  = listings.filter((l) => l.bedrooms != null).length;
  info(`price=${withPrice}/${listings.length}  beds=${withBeds}/${listings.length}`);

  for (const l of listings.slice(0, 3)) {
    console.log(`    • ${l.title.slice(0, 60)}`);
    console.log(`      R$ ${l.price.toLocaleString('pt-BR')} | ${l.bedrooms ?? '?'}q | ${l.neighborhood || '?'}`);
  }
}

// ─── Layer 4: Firecrawl SCRAPE de imóvel individual ──────────────────────────

async function testFirecrawlListingScrape(fc: FirecrawlApp) {
  sep('LAYER 4 — Firecrawl SCRAPE (imóvel individual)');

  let result: unknown;
  try {
    result = await withTimer('Firecrawl scrape imóvel individual', () =>
      fc.scrape(SAMPLE_LISTING, {
        formats: ['markdown'],
        timeout: 30000,
      } as Parameters<typeof fc.scrape>[1]),
    );
  } catch (err) {
    fail(`Scrape individual falhou: ${err}`);
    return;
  }

  const md = (result as Record<string, unknown>).markdown as string | undefined;
  if (!md || md.length < 200) {
    warn(`Markdown muito curto ou vazio (${md?.length ?? 0} chars) — página pode exigir JS`);
    return;
  }

  ok(`Markdown obtido: ${md.length} chars`);
  // Verifica presença de campos esperados num imóvel brasileiro
  const checks = [
    { label: 'preço',     re: /R\$|reais|valor/i },
    { label: 'quartos',   re: /quart|suite/i },
    { label: 'área',      re: /m²|metros|área/i },
    { label: 'bairro',    re: /bairro|flamengo|recreio|barra|tijuca/i },
  ];
  for (const { label, re } of checks) {
    if (re.test(md)) ok(`Campo "${label}" detectado no markdown`);
    else warn(`Campo "${label}" não detectado — pode faltar dados no scrape`);
  }
}

// ─── Firecrawl health check ───────────────────────────────────────────────────

async function checkFirecrawlHealth(): Promise<FirecrawlApp | null> {
  sep('Firecrawl health check');

  if (!FC_API_KEY) {
    warn('FIRECRAWL_API_KEY não definida — pulando layers 2-4');
    return null;
  }

  info(`API URL: ${FC_API_URL ?? '(cloud default)'}`);
  info(`API Key: ${FC_API_KEY.slice(0, 12)}...`);

  const fc = new FirecrawlApp({ apiKey: FC_API_KEY, apiUrl: FC_API_URL });

  try {
    await withTimer('health /v1/crawl-limit', () =>
      fetch(`${FC_API_URL ?? 'https://api.firecrawl.dev'}/v1/crawl-limit`, {
        headers: { Authorization: `Bearer ${FC_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      }).then((r) => r.json()),
    );
    ok('Firecrawl self-hosted respondeu');
    return fc;
  } catch {
    try {
      // Fallback: test com scrape simples
      await withTimer('health ping via scrape example.com', () =>
        fc.scrape('https://example.com', { formats: ['markdown'], timeout: 15000 } as Parameters<typeof fc.scrape>[1]),
      );
      ok('Firecrawl respondeu (via scrape de health)');
      return fc;
    } catch (err2) {
      fail(`Firecrawl inacessível — túnel SSH ativo? (${err2})`);
      info('Para ativar: ssh -N -L 3004:localhost:3004 root@31.97.245.82');
      return null;
    }
  }
}


// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🏠 PropMatch AI — Teste de scraping kariocaimoveis.com.br');
  console.log(`   ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`);

  // Layer 1 sempre roda — sem dependências externas
  await testHtmlScraper();

  // Layers 2-4 dependem do Firecrawl
  const fc = await checkFirecrawlHealth();
  if (fc) {
    await testFirecrawlMap(fc);
    await testFirecrawlSearchScrape(fc);
    await testFirecrawlListingScrape(fc);
  }

  sep('RESUMO');
  console.log('  Layer 1 (HTML scraper): sempre disponível');
  console.log(`  Layers 2-4 (Firecrawl): ${fc ? '✅ testados' : '⏭  pulados (túnel inativo)'}`);
  console.log('');
}

main().catch((err) => {
  console.error('\n💥 Erro fatal:', err);
  process.exit(1);
});
