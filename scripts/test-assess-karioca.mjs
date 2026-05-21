// Script de teste: assessSite() na Karioca Imóveis
// Roda com: node scripts/test-assess-karioca.mjs

import { readFileSync } from 'fs';
// Parse .env.local manually — dotenv não é garantido como dep direta
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

import FirecrawlApp from '@mendable/firecrawl-js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY não definida em .env.local');

const KARIOCA_BASE_URL = 'https://kariocaimoveis.com.br';
const KARIOCA_PATTERNS = ['/imovel/', '/casa-em-condominio/'];

console.log('🔍 Iniciando Firecrawl MAP em:', KARIOCA_BASE_URL);
console.log('⏳ Aguardando resposta...\n');

const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL; // undefined → cloud
if (FIRECRAWL_API_URL) console.log('🔌 Self-hosted:', FIRECRAWL_API_URL);

const firecrawl = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY, apiUrl: FIRECRAWL_API_URL });

const start = Date.now();

try {
  const mapResult = await firecrawl.map(KARIOCA_BASE_URL, { limit: 5000 });

  const allLinks = (mapResult.links ?? []).map((entry) =>
    typeof entry === 'string' ? entry : entry.url,
  );

  const listingUrls = [...new Set(
    allLinks.filter((url) =>
      KARIOCA_PATTERNS.some((p) => url.includes(p))
    ),
  )];

  const durationMs = Date.now() - start;

  console.log(`✅ MAP concluído em ${durationMs}ms`);
  console.log(`📊 Total de links descobertos: ${allLinks.length}`);
  console.log(`🏠 URLs de imóveis encontradas: ${listingUrls.length}`);
  console.log('\nPrimeiras 10 URLs:');
  listingUrls.slice(0, 10).forEach((url, i) => console.log(`  ${i + 1}. ${url}`));

  if (listingUrls.length > 10) {
    console.log(`  ... e mais ${listingUrls.length - 10} imóveis`);
  }

  // Distribuição por padrão
  console.log('\nDistribuição por padrão de URL:');
  for (const pattern of KARIOCA_PATTERNS) {
    const count = listingUrls.filter((u) => u.includes(pattern)).length;
    console.log(`  ${pattern}: ${count} imóveis`);
  }

} catch (err) {
  console.error('❌ Erro:', err.message);
  process.exit(1);
}
