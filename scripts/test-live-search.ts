// Teste de busca ao vivo — scrape pontual em ambos os sites, sem banco de dados.
// Simula exatamente o que acontece numa busca real de um corretor.
//
// Roda com:
//   dotenv -e .env.local -- tsx scripts/test-live-search.ts

// Bootstrap: mock server-only so this script runs outside Next.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./mock-server-only.cjs');

import type { NormalizedListing, SearchCriteria } from '../src/server/search/types';

// ─── Briefing do teste ───────────────────────────────────────────────────────
// "Apartamento, 2+ quartos, até R$800.000, nos bairros Barra Olímpica e Recreio"
// A lista de neighborhoods inclui variações de linguagem popular (sem acento,
// nome abreviado) para validar que o fit-score reconhece "Recreio" como match.
const CRITERIA: SearchCriteria = {
  purpose:       'buy',
  city:          'Rio de Janeiro',
  state:         'RJ',
  propertyType:  'apartment',
  bedroomsMin:   2,
  priceMax:      800_000,
  // Inclui variações: com acento, sem acento, abreviado — linguagem popular
  neighborhoods: [
    'Barra Olímpica',
    'Barra Olimpica',
    'Recreio dos Bandeirantes',
    'Recreio',
  ],
};

const MIN_PRICE_VALID = 50_000; // abaixo disso = aluguel ou dado inválido

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function badge(score: number) {
  if (score >= 80) return '🟢';
  if (score >= 55) return '🟡';
  return '🔴';
}

function printListing(l: NormalizedListing, score: number, index: number) {
  console.log(`\n  ${index}. ${badge(score)} [score ${score}] ${l.title || '(sem título)'}`);
  console.log(`     💰 ${fmt(l.price)}  🛏 ${l.bedrooms ?? '?'} quartos  📐 ${l.areaSqm ?? '?'} m²`);
  console.log(`     📍 ${l.neighborhood || '?'} — ${l.city}`);
  console.log(`     🔗 ${l.url}`);
  if (l.photos?.[0]) console.log(`     🖼  ${l.photos[0]}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { prisma }           = await import('../src/server/db/client');
  const { scrapePartnerSite } = await import('../src/server/partners/strategy');
  const { fitScore }          = await import('../src/server/search/fit-score');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        TESTE DE BUSCA AO VIVO — PropMatch AI             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('📋 Briefing:', JSON.stringify(CRITERIA, null, 2));
  console.log('');

  const sites = await prisma.partnerSite.findMany({
    where: { active: true },
    orderBy: { domain: 'asc' },
  });

  if (sites.length === 0) {
    console.error('❌ Nenhum partner site cadastrado no banco.');
    await prisma.$disconnect();
    process.exit(1);
  }

  const totalStart = Date.now();
  const allResults: Array<{
    domain: string;
    listings: NormalizedListing[];
    durationMs: number;
    error?: string;
  }> = [];

  for (const site of sites) {
    console.log(`\n${'─'.repeat(58)}`);
    console.log(`🌐 Site: ${site.domain}  (estratégia: ${site.discoveryStrategy})`);
    console.log(`   syncStatus: ${site.syncStatus}  (idle = scrape ao vivo ✓)`);
    console.log(`   Buscando...`);

    const start = Date.now();
    try {
      // Força scrape ao vivo independente do syncStatus do banco
      const listings = await scrapePartnerSite(site, CRITERIA);
      const durationMs = Date.now() - start;

      allResults.push({ domain: site.domain, listings, durationMs });

      // Filtra preços inválidos (aluguel disfarçado ou dado ruim)
      const valid = listings.filter((l) => l.price >= MIN_PRICE_VALID);
      const invalid = listings.length - valid.length;

      console.log(`\n   ✅ Scrape concluído em ${(durationMs / 1000).toFixed(1)}s`);
      console.log(`   📦 ${listings.length} imóveis encontrados  (${invalid} descartados — preço < ${fmt(MIN_PRICE_VALID)})`);

      if (valid.length === 0) {
        console.log('   ⚠️  Nenhum resultado válido após filtragem de preço.');
        continue;
      }

      // Aplica fit-score, descarta hard-fails (score=0 = preço > 120% do teto), ordena
      const scored = valid
        .map((l) => fitScore(l, CRITERIA))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);

      const hardFailed = valid.length - scored.length;
      if (hardFailed > 0) {
        console.log(`   🚫 ${hardFailed} descartados — preço acima de 120% do teto (R$${(800_000 * 1.2).toLocaleString('pt-BR')})`);
      }

      if (scored.length === 0) {
        console.log('   ⚠️  Nenhum resultado após filtro de preço máximo.');
        continue;
      }

      console.log(`\n   📊 Resultados ordenados por fit-score (${scored.length} válidos):`);
      scored.forEach(({ listing, score }, i) => printListing(listing, score, i + 1));

    } catch (err) {
      const durationMs = Date.now() - start;
      const error = String(err);
      allResults.push({ domain: site.domain, listings: [], durationMs, error });
      console.log(`\n   ❌ Erro após ${(durationMs / 1000).toFixed(1)}s: ${error}`);
    }
  }

  // ─── Resumo final ───────────────────────────────────────────────────────────
  const totalMs = Date.now() - totalStart;
  const totalListings = allResults.reduce((s, r) => s + r.listings.length, 0);
  const validTotal = allResults
    .flatMap((r) => r.listings)
    .filter((l) => l.price >= MIN_PRICE_VALID).length;

  console.log(`\n${'═'.repeat(58)}`);
  console.log('📈 RESUMO FINAL');
  console.log(`${'─'.repeat(58)}`);
  for (const r of allResults) {
    const status = r.error ? `❌ erro` : `✅ ${r.listings.filter(l => l.price >= MIN_PRICE_VALID).length} válidos`;
    console.log(`   ${r.domain.padEnd(30)} ${status}  (${(r.durationMs / 1000).toFixed(1)}s)`);
  }
  console.log(`${'─'.repeat(58)}`);
  console.log(`   Total bruto:   ${totalListings} imóveis`);
  console.log(`   Total válidos: ${validTotal} imóveis (preço ≥ ${fmt(MIN_PRICE_VALID)})`);
  console.log(`   Tempo total:   ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`   Meta (≥7):     ${validTotal >= 7 ? '✅ ATINGIDA' : `⚠️  ABAIXO (${validTotal}/7)`}`);
  console.log(`${'═'.repeat(58)}\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
