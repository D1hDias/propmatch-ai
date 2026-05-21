// Sync Fatti Imóveis → banco de dados via Kenlo API
// Roda com: dotenv -e .env.local -- npx tsx scripts/sync-fatti.ts

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./mock-server-only.cjs');

const FATTI_DOMAIN = 'www.fattiimoveis.com.br';

async function main() {
  const { prisma } = await import('../src/server/db/client');
  const { syncSite } = await import('../src/server/partners/site-sync');

  const site = await prisma.partnerSite.findFirst({ where: { domain: FATTI_DOMAIN } });
  if (!site) { console.error(`❌ "${FATTI_DOMAIN}" não encontrado`); process.exit(1); }

  console.log(`🏠 ${site.name} | estratégia: ${site.discoveryStrategy}`);
  const progressInterval = setInterval(() => process.stdout.write('.'), 3000);

  try {
    const result = await syncSite(site);
    clearInterval(progressInterval);
    process.stdout.write('\n\n');
    console.log(`✅ Sync concluído em ${Math.floor(result.durationMs / 1000)}s`);
    console.log(`   ➕ Adicionados: ${result.added} | ❌ Removidos: ${result.removed} | ⚠️  Erros: ${result.errors}`);

    const count = await prisma.property.count({ where: { active: true, sources: { some: { partnerSiteId: site.id } } } });
    console.log(`\n📊 Total no banco: ${count} imóveis`);

    const samples = await prisma.property.findMany({
      where: { active: true, sources: { some: { partnerSiteId: site.id } } },
      include: { sources: { where: { partnerSiteId: site.id }, take: 1 } },
      orderBy: { lastSeenAt: 'desc' }, take: 3,
    });
    console.log('\n🔍 Exemplos:');
    for (const p of samples) {
      const src = p.sources[0];
      console.log(`   • ${src?.title ?? '?'}`);
      console.log(`     R$ ${Number(p.price ?? 0).toLocaleString('pt-BR')} | ${p.bedrooms ?? '?'}q | ${p.neighborhood ?? '?'} | ${Number(p.areaSqm ?? 0)}m²`);
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
