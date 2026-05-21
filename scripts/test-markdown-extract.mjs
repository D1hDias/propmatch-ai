// Testa o novo fluxo: Firecrawl markdown (1 crédito) + OpenRouter extrai dados
// Roda com: node scripts/test-markdown-extract.mjs

import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

import FirecrawlApp from '@mendable/firecrawl-js';
import OpenAI from 'openai';

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'PropMatch AI' },
});

const TEST_URLS = [
  'https://kariocaimoveis.com.br/imovel/apartamento-para-venda-condominio-verano-rio2/KR6382972',
  'https://kariocaimoveis.com.br/imovel/apartamento-a-venda-frente-mar-na-barra-da-tijuca/KR248569',
  'https://kariocaimoveis.com.br/imovel/apartamento-3-quartos-1-suite-reformado-flamengo/KR468577',
];

const SCHEMA = {
  type: 'object',
  properties: {
    title:         { type: 'string' },
    price:         { type: 'number' },
    bedrooms:      { type: 'number' },
    bathrooms:     { type: 'number' },
    area_sqm:      { type: 'number' },
    parking:       { type: 'number' },
    neighborhood:  { type: 'string' },
    city:          { type: 'string' },
    property_type: { type: 'string' },
    description:   { type: 'string' },
    image_url:     { type: 'string' },
    address:       { type: 'string' },
  },
  required: ['title', 'price'],
  additionalProperties: false,
};

console.log(`🔍 Testando: Firecrawl markdown + OpenRouter extração`);
console.log(`   Modelo: openai/gpt-4.1-nano`);
console.log(`   URLs: ${TEST_URLS.length}\n`);

// Step 1: batchScrape markdown
console.log('📥 Passo 1: Firecrawl batchScrape (markdown, 1 crédito/URL)...');
const t1 = Date.now();

const batchResult = await firecrawl.batchScrape(TEST_URLS, {
  options: { formats: ['markdown'] },
});

console.log(`   ✅ ${((Date.now() - t1)/1000).toFixed(1)}s — status: ${batchResult.status}`);
console.log(`   Páginas recebidas: ${batchResult.data?.length ?? 0}\n`);

const pages = batchResult.data ?? [];

// Step 2: OpenRouter extração
console.log('🤖 Passo 2: OpenRouter extração (gpt-4.1-nano)...');

for (let i = 0; i < pages.length; i++) {
  const page = pages[i];
  const url = TEST_URLS[i];
  const markdown = page?.markdown ?? '';

  console.log(`\n─── Imóvel ${i+1}: ${url.split('/').slice(-2).join('/')}`);
  console.log(`   Markdown: ${markdown.length} chars`);

  if (markdown.length < 50) {
    console.log('   ⚠️  Markdown muito curto, pulando');
    continue;
  }

  const t2 = Date.now();
  try {
    const resp = await openai.chat.completions.create({
      model: 'openai/gpt-4.1-nano',
      max_tokens: 512,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'listing', strict: true, schema: SCHEMA },
      },
      messages: [
        {
          role: 'system',
          content: 'Você é um extrator de dados de imóveis. Leia o texto abaixo de uma página de anúncio imobiliário e retorne os dados em JSON. Para campos não encontrados, omita-os. Preço deve ser número em BRL (sem R$, sem pontos).',
        },
        { role: 'user', content: markdown.slice(0, 4000) },
      ],
    });

    const raw = JSON.parse(resp.choices[0]?.message?.content ?? 'null');
    const ms = Date.now() - t2;
    const tokens = resp.usage?.total_tokens ?? 0;

    if (!raw) {
      console.log('   ❌ JSON inválido');
      continue;
    }

    console.log(`   ✅ Extraído em ${ms}ms (${tokens} tokens)`);
    console.log(`   Título:    ${raw.title}`);
    console.log(`   Preço:     R$ ${Number(raw.price ?? 0).toLocaleString('pt-BR')}`);
    console.log(`   Quartos:   ${raw.bedrooms ?? '—'}`);
    console.log(`   Área:      ${raw.area_sqm ?? '—'} m²`);
    console.log(`   Bairro:    ${raw.neighborhood ?? '—'}`);
    console.log(`   Foto:      ${raw.image_url ? '✅' : '—'}`);

  } catch (err) {
    console.log(`   ❌ Erro: ${err.message}`);
  }
}

console.log('\n\n📊 Custo estimado por imóvel:');
console.log('   Firecrawl: 1 crédito/URL (vs 5 créditos com LLM interno)');
console.log('   OpenRouter gpt-4.1-nano: ~$0.0003/URL (~$0.06 para 200 imóveis)');
console.log('   Economia: ~80% menos créditos Firecrawl');
