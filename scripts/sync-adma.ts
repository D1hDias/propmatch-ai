// Sync ADMA Imobiliária → banco de dados via Sitemidas hidden API
// Roda com: dotenv -e .env.local -- tsx scripts/sync-adma.ts

// Bootstrap: mock server-only so this script runs outside Next.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./mock-server-only.cjs');

const ADMA_DOMAIN = 'www.admaimobiliaria.com.br';

async function main() {
  const { prisma } = await import('../src/server/db/client');
  const { syncSite } = await import('../src/server/partners/site-sync');

  const site = await prisma.partnerSite.findFirst({
    where: { domain: ADMA_DOMAIN },
  });

  if (!site) {
    console.error(`❌ Site "${ADMA_DOMAIN}" não encontrado no banco.`);
    process.exit(1);
  }

  console.log(`🏠 Iniciando sync: ${site.name}`);
  console.log(`   Base URL: ${site.baseUrl}`);
  console.log(`   Estratégia: ${site.discoveryStrategy}`);
  console.log('');

  const progressInterval = setInterval(() => process.stdout.write('.'), 3000);

  try {
    const result = await syncSite(site);
    clearInterval(progressInterval);
    process.stdout.write('\n\n');

    const mins = Math.floor(result.durationMs / 60000);
    const secs = Math.floor((result.durationMs % 60000) / 1000);

    console.log(`✅ Sync concluído em ${mins}m ${secs}s`);
    console.log(`   ➕ Adicionados:  ${result.added} imóveis`);
    console.log(`   ❌ Removidos:   ${result.removed} imóveis`);
    console.log(`   ⚠️  Erros:       ${result.errors}`);

    const count = await prisma.property.count({
      where: { active: true, sources: { some: { partnerSiteId: site.id } } },
    });
    console.log(`\n📊 Total no banco (active): ${count} imóveis da ADMA`);

    const samples = await prisma.property.findMany({
      where: { active: true, sources: { some: { partnerSiteId: site.id } } },
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
