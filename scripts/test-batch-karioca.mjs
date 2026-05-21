// Teste: batchScrape em 5 URLs da Karioca Imóveis
// Confirma que preço, quartos, bairro, área e foto são extraídos corretamente
// Consumo estimado: 5 créditos Firecrawl
// Roda com: node scripts/test-batch-karioca.mjs

import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

import FirecrawlApp from '@mendable/firecrawl-js';

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

// 5 URLs diversas para cobrir diferentes bairros e tipos
const TEST_URLS = [
  'https://kariocaimoveis.com.br/imovel/apartamento-3-quartos-1-suite-reformado-flamengo/KR468577',
  'https://kariocaimoveis.com.br/imovel/apartamento-2-quartos-60m2-flamengo/KR688566',
  'https://kariocaimoveis.com.br/imovel/apartamento-a-venda-frente-mar-na-barra-da-tijuca/KR248569',
  'https://kariocaimoveis.com.br/imovel/apartamento-para-venda-condominio-verano-rio2/KR6382972',
  'https://kariocaimoveis.com.br/imovel/apartamento-reformado-1-quarto-suiteescritorio-e-lavabo/KR548576',
];

const SCHEMA = {
  type: 'object',
  properties: {
    title:         { type: 'string' },
    price:         { type: 'number', description: 'Sale price in BRL, number only' },
    bedrooms:      { type: 'number' },
    bathrooms:     { type: 'number' },
    area_sqm:      { type: 'number', description: 'Total area in m², number only' },
    parking:       { type: 'number' },
    neighborhood:  { type: 'string', description: 'Neighborhood (bairro)' },
    city:          { type: 'string' },
    property_type: { type: 'string' },
    description:   { type: 'string', description: 'Property description (max 200 chars)' },
    image_url:     { type: 'string', description: 'Cover photo URL (first/main image only)' },
    address:       { type: 'string', description: 'Street address if shown on the page' },
  },
  required: ['title', 'price'],
};

console.log(`🚀 batchScrape em ${TEST_URLS.length} URLs da Karioca`);
console.log('⏳ Aguardando Firecrawl...\n');

const start = Date.now();

try {
  const batchResult = await firecrawl.batchScrape(TEST_URLS, {
    options: {
      formats: [
        {
          type: 'json',
          prompt:
            'Extract the property listing details from this real estate page: ' +
            'title, sale price in BRL (number only), bedrooms (quartos), bathrooms (banheiros), ' +
            'total area in m² (number only), parking spots (vagas), neighborhood (bairro), city, ' +
            'property type (apartamento/casa/studio/cobertura), brief description (max 200 chars), ' +
            'cover photo URL (first image only), and street address if visible.',
          schema: SCHEMA,
        },
      ],
    },
  });

  const durationMs = Date.now() - start;
  console.log(`✅ batchScrape concluído em ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`Status: ${batchResult.status}`);
  console.log(`Páginas retornadas: ${batchResult.data?.length ?? 0}\n`);

  if (batchResult.status === 'failed') {
    console.error('❌ Batch falhou.');
    process.exit(1);
  }

  let ok = 0;
  let missing = 0;

  const pages = batchResult.data ?? [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const url = TEST_URLS[i];
    const raw = page?.json;

    console.log(`─── Imóvel ${i + 1}: ${url.split('/').slice(-2).join('/')}`);

    if (!raw || !raw.price || !raw.title) {
      console.log('  ⚠️  Dados insuficientes (sem preço ou título)\n');
      missing++;
      continue;
    }

    ok++;
    console.log(`  Título:    ${raw.title}`);
    console.log(`  Preço:     R$ ${Number(raw.price).toLocaleString('pt-BR')}`);
    console.log(`  Quartos:   ${raw.bedrooms ?? '—'}`);
    console.log(`  Banheiros: ${raw.bathrooms ?? '—'}`);
    console.log(`  Área:      ${raw.area_sqm ?? '—'} m²`);
    console.log(`  Vagas:     ${raw.parking ?? '—'}`);
    console.log(`  Bairro:    ${raw.neighborhood ?? '—'}`);
    console.log(`  Cidade:    ${raw.city ?? '—'}`);
    console.log(`  Tipo:      ${raw.property_type ?? '—'}`);
    console.log(`  Foto:      ${raw.image_url ? '✅ ' + raw.image_url.substring(0, 60) + '...' : '—'}`);
    console.log(`  Endereço:  ${raw.address ?? '—'}`);
    console.log(`  Descrição: ${raw.description ? raw.description.substring(0, 80) + '...' : '—'}`);
    console.log();
  }

  console.log(`\n📊 Resultado: ${ok}/${TEST_URLS.length} imóveis extraídos com sucesso, ${missing} sem dados`);

  if (ok >= 4) {
    console.log('🎯 Extração funcionando bem — pronto para syncSite() completo!');
  } else {
    console.log('⚠️  Extração parcial — revisar schema ou prompt antes do sync completo.');
  }

} catch (err) {
  console.error('❌ Erro:', err.message);
  process.exit(1);
}
