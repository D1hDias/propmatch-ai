// Sync completo da Karioca Imóveis → banco de dados
// Roda com: pnpm sync:karioca  (ou: dotenv -e .env.local -- tsx scripts/sync-karioca.ts)
//
// Fluxo:
//   1. MAP → descobre todas as URLs de imóveis (~1 crédito)
//   2. Delta → compara com DB, calcula novos e removidos
//   3. batchScrape → extrai dados dos novos imóveis (1 crédito/URL)
//   4. Upsert → salva em properties + property_sources
//   5. Remove → marca active=false para imóveis que saíram do site

// Bootstrap: mock server-only so this script runs outside Next.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./mock-server-only.cjs');

const KARIOCA_DOMAIN = 'kariocaimoveis.com.br';

async function main() {
  // Dynamic imports AFTER mock is registered — server-only guard won't fire
  const { prisma } = await import('../src/server/db/client');
  const { syncSite } = await import('../src/server/partners/site-sync');

  const site = await prisma.partnerSite.findFirst({
    where: { domain: KARIOCA_DOMAIN },
  });

  if (!site) {
    console.error(`❌ Site "${KARIOCA_DOMAIN}" não encontrado no banco.`);
    process.exit(1);
  }

  console.log(`🏠 Iniciando sync completo: ${site.domain}`);
  console.log(`   Base URL: ${site.baseUrl}`);
  console.log(`   Padrões:  ${site.propertyUrlPatterns.join(', ')}`);
  console.log('');

  const progressInterval = setInterval(() => {
    process.stdout.write('.');
  }, 5000);

  try {
    const result = await syncSite(site);

    clearInterval(progressInterval);
    process.stdout.write('\n\n');

    const mins = Math.floor(result.durationMs / 60000);
    const secs = Math.floor((result.durationMs % 60000) / 1000);

    console.log(`✅ Sync concluído em ${mins}m ${secs}s`);
    console.log(`   ➕ Adicionados:  ${result.added} imóveis`);
    console.log(`   ❌ Removidos:   ${result.removed} imóveis (marcados inactive)`);
    console.log(`   ⚠️  Erros:       ${result.errors} URLs com falha na extração`);

    // Verificação no banco
    const count = await prisma.property.count({
      where: {
        active: true,
        sources: { some: { partnerSiteId: site.id } },
      },
    });
    console.log(`\n📊 Total no banco (active): ${count} imóveis da Karioca`);

    // Mostra 3 exemplos do banco
    const samples = await prisma.property.findMany({
      where: {
        active: true,
        sources: { some: { partnerSiteId: site.id } },
      },
      include: { sources: { where: { partnerSiteId: site.id }, take: 1 } },
      orderBy: { lastSeenAt: 'desc' },
      take: 3,
    });

    console.log('\n🔍 Últimos 3 imóveis salvos:');
    for (const p of samples) {
      const src = p.sources[0];
      console.log(`   • ${src?.title ?? 'sem título'}`);
      console.log(`     R$ ${Number(p.price).toLocaleString('pt-BR')} | ${p.bedrooms ?? '?'} qts | ${p.neighborhood ?? '?'} | ${Number(p.areaSqm ?? 0)}m²`);
      console.log(`     ${src?.url}`);
    }

  } catch (err) {
    clearInterval(progressInterval);
    console.error('\n❌ Sync falhou:', err);
    process.exit(1);
  } finally {
    const { prisma: db } = await import('../src/server/db/client');
    await db.$disconnect();
  }
}

main();
