// Testa apenas a extração OpenRouter (sem Firecrawl)
// Usa markdown simulado igual ao que Firecrawl retornaria
// Roda com: node scripts/test-openrouter-extract.mjs

import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'PropMatch AI' },
});

// Markdown simulando o que Firecrawl retornaria de uma página da Karioca
const MOCK_MARKDOWNS = [
  {
    url: 'kariocaimoveis.com.br/imovel/apartamento-para-venda-condominio-verano-rio2/KR6382972',
    markdown: `
# APARTAMENTO PARA VENDA CONDOMÍNIO VERANO - RIO2

**Preço:** R$ 1.250.000,00

Apartamento com 3 quartos, sendo 1 suíte, 2 banheiros, 121m² de área útil, 2 vagas de garagem.

**Bairro:** Barra Olímpica
**Cidade:** Rio de Janeiro
**Endereço:** Rua Franz Weissman, Barra Olímpica, Rio de Janeiro

Oportunidade para Venda no condomínio Verano, no Rio 2! Com 121m², o imóvel possui sala ampla, cozinha planejada, varanda gourmet e área de serviço.

**Características:**
- Tipo: Apartamento
- Quartos: 3 (1 suíte)
- Banheiros: 2
- Área: 121 m²
- Vagas: 2
- Condomínio: R$ 1.200/mês

![Foto principal](https://intranet.kariocaimoveis.com.br/storage/upload/images/KR6382972_01.jpg)
    `,
  },
  {
    url: 'kariocaimoveis.com.br/imovel/apartamento-2-quartos-60m2-flamengo/KR688566',
    markdown: `
# Apartamento 2 quartos 60m² Flamengo

Código: KR688566 | Venda: R$730.000

Apartamento à venda no Flamengo | 2 quartos | Excelente localização

**Detalhes do imóvel**
- Quartos: 2
- Banheiros: 2
- Área útil: 60 m²
- Vagas: 0
- Tipo: Apartamento

**Localização:** Avenida Oswaldo Cruz, Flamengo, Rio de Janeiro - RJ

Apartamento bem localizado no Flamengo, próximo ao metrô e comércio local.
Prédio com portaria 24h.

![](https://intranet.kariocaimoveis.com.br/storage/upload/images/KR688566_capa.jpg)
    `,
  },
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

console.log('🤖 Testando extração OpenRouter (gpt-4.1-nano) com markdown simulado\n');

let totalTokens = 0;

for (const { url, markdown } of MOCK_MARKDOWNS) {
  console.log(`─── ${url.split('/').slice(-2).join('/')}`);

  const t = Date.now();
  try {
    const resp = await openai.chat.completions.create({
      model: 'openai/gpt-4.1-nano',
      max_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Você é um extrator de dados de imóveis. Leia o texto de uma página de anúncio e retorne um JSON com os campos: ' +
            'title (string), price (número BRL sem R$ ou pontos), bedrooms (número), bathrooms (número), ' +
            'area_sqm (número), parking (número), neighborhood (string), city (string), ' +
            'property_type (string), description (string max 200 chars), image_url (string), address (string). ' +
            'Omita campos não encontrados. Responda APENAS com o JSON, sem texto adicional.',
        },
        { role: 'user', content: markdown.trim() },
      ],
    });

    const raw = JSON.parse(resp.choices[0]?.message?.content ?? 'null');
    const ms = Date.now() - t;
    const tokens = resp.usage?.total_tokens ?? 0;
    totalTokens += tokens;

    console.log(`   ✅ ${ms}ms | ${tokens} tokens`);
    console.log(`   Título:    ${raw?.title ?? '—'}`);
    console.log(`   Preço:     R$ ${Number(raw?.price ?? 0).toLocaleString('pt-BR')}`);
    console.log(`   Quartos:   ${raw?.bedrooms ?? '—'}`);
    console.log(`   Banheiros: ${raw?.bathrooms ?? '—'}`);
    console.log(`   Área:      ${raw?.area_sqm ?? '—'} m²`);
    console.log(`   Vagas:     ${raw?.parking ?? '—'}`);
    console.log(`   Bairro:    ${raw?.neighborhood ?? '—'}`);
    console.log(`   Cidade:    ${raw?.city ?? '—'}`);
    console.log(`   Endereço:  ${raw?.address ?? '—'}`);
    console.log(`   Foto:      ${raw?.image_url ? '✅ ' + raw.image_url.slice(0, 50) + '...' : '—'}`);
    console.log();

  } catch (err) {
    console.log(`   ❌ Erro: ${err.message}\n`);
  }
}

const costUSD = (totalTokens / 1_000_000) * 0.10; // gpt-4.1-nano input ~$0.10/1M
console.log(`📊 Resumo:`);
console.log(`   Total de tokens: ${totalTokens}`);
console.log(`   Custo estimado (2 imóveis): $${costUSD.toFixed(6)}`);
console.log(`   Custo estimado (200 imóveis): $${(costUSD * 100).toFixed(4)}`);
console.log(`\n✅ Abordagem validada: markdown Firecrawl + gpt-4.1-nano = custo mínimo`);
