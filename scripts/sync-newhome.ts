// Sync completo da New Home Imóveis → banco de dados
// Roda com: dotenv -e .env.local -- npx tsx --conditions=react-server scripts/sync-newhome.ts

// Bootstrap: mock server-only so this script runs outside Next.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./mock-server-only.cjs');

const NEWHOME_DOMAIN = 'www.imoveisnewhome.com.br';

async function main() {
  const { prisma } = await import('../src/server/db/client');
  const { syncSite } = await import('../src/server/partners/site-sync');

  const site = await prisma.partnerSite.findFirst({
    where: { domain: NEWHOME_DOMAIN },
  });

  if (!site) {
    console.error(`❌ Site "${NEWHOME_DOMAIN}" não encontrado no banco.`);
    process.exit(1);
  }

  console.log(`🏠 Iniciando sync completo: ${site.domain}`);
  console.log(`   Base URL:  ${site.baseUrl}`);
  console.log(`   SeedUrls:  ${site.seedUrls.join(', ')}`);
  console.log(`   Padrões:   ${site.propertyUrlPatterns.join(', ')}`);
  console.log('');

  const progressInterval = setInterval(() => {
    process.stdout.write('.');
  }, 5000);

  try {
    await syncSite(site);
    clearInterval(progressInterval);
    console.log('\n✅ Sync concluído!');

    const updated = await prisma.partnerSite.findFirst({
      where: { domain: NEWHOME_DOMAIN },
      select: { listingCount: true, syncStatus: true, lastScrapedAt: true },
    });
    console.log(`   Imóveis no cache: ${updated?.listingCount}`);
    console.log(`   syncStatus:       ${updated?.syncStatus}`);
    console.log(`   Último scrape:    ${updated?.lastScrapedAt}`);
  } catch (err) {
    clearInterval(progressInterval);
    console.error('\n❌ Erro no sync:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
