// Mostra o estado do último briefing criado + o que runSearch encontraria
import { prisma } from '../src/server/db/client';

async function main() {
  // Último briefing
  const briefing = await prisma.briefing.findFirst({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      rawText: true,
      status: true,
      reviewStatus: true,
      reviewMode: true,
      extractionConfidence: true,
      selectedPortals: true,
      extractedCriteria: true,
      createdAt: true,
    },
  });

  if (!briefing) { console.log('Nenhum briefing encontrado.'); process.exit(0); }

  console.log('\n=== ÚLTIMO BRIEFING ===');
  console.log(`ID:           ${briefing.id}`);
  console.log(`Status:       ${briefing.status}`);
  console.log(`Review:       ${briefing.reviewStatus} / ${briefing.reviewMode}`);
  console.log(`Confidence:   ${briefing.extractionConfidence}`);
  console.log(`selectedPortals: ${JSON.stringify(briefing.selectedPortals)}`);
  console.log(`rawText:      ${briefing.rawText?.slice(0, 100)}`);
  console.log(`criteria:     ${JSON.stringify(briefing.extractedCriteria, null, 2)}`);

  // Resultados do briefing
  const results = await prisma.briefingResult.findMany({
    where: { briefingId: briefing.id },
    take: 5,
  });
  console.log(`\nResultados salvos: ${results.length}`);

  // Sites parceiros disponíveis
  const sites = await prisma.partnerSite.findMany({
    where: { active: true },
    select: { id: true, domain: true, syncStatus: true, listingCount: true, lastScrapedAt: true },
  });
  console.log('\n=== SITES PARCEIROS ATIVOS ===');
  sites.forEach(s => console.log(`  ${s.domain} | sync=${s.syncStatus} | listings=${s.listingCount} | scrapedAt=${s.lastScrapedAt?.toISOString() ?? 'nunca'}`));

  // Imóveis no banco
  const propCount = await prisma.property.count({ where: { active: true } });
  console.log(`\n=== DB ===`);
  console.log(`Imóveis ativos: ${propCount}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
