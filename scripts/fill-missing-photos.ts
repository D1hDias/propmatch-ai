// Busca imóveis sem foto no banco e re-extrai via Firecrawl formats:['images'].
// Roda com: dotenv -e .env.local -- tsx scripts/fill-missing-photos.ts
//
// Seguro para rodar múltiplas vezes (só processa os que ainda não têm foto).

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./mock-server-only.cjs');

const CONCURRENCY = 5;
const DELAY_MS = 1200;

// Filtra para pegar só imagens que parecem fotos de imóveis (não ícones/logos).
// Karioca usa /storage/upload/images/ ou /intranet/ para as fotos reais.
function pickBestPhoto(images: string[]): string | null {
  const preferred = images.find(
    (u) =>
      u.includes('/storage/') ||
      u.includes('/upload/') ||
      u.includes('/fotos/') ||
      u.includes('/imovel/') ||
      u.match(/\.(jpe?g|png|webp)(\?|$)/i),
  );
  return preferred ?? images[0] ?? null;
}

void (async () => {
  const { prisma } = await import('../src/server/db/client');
  const FirecrawlApp = (await import('@mendable/firecrawl-js')).default;

  const apiKey = process.env.FIRECRAWL_API_KEY;
  const apiUrl = process.env.FIRECRAWL_API_URL;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY não definida');

  const firecrawl = new FirecrawlApp({ apiKey, apiUrl });

  const noPhotos = await prisma.propertySource_.findMany({
    where: { photos: { equals: [] } },
    select: { id: true, url: true },
  });

  if (noPhotos.length === 0) {
    console.log('✅ Nenhum imóvel sem foto — nada a fazer.');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n📷 ${noPhotos.length} imóveis sem foto. Iniciando re-extração...\n`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < noPhotos.length; i += CONCURRENCY) {
    const chunk = noPhotos.slice(i, i + CONCURRENCY);
    process.stdout.write(`  [${i + 1}–${Math.min(i + CONCURRENCY, noPhotos.length)}/${noPhotos.length}] `);

    await Promise.all(
      chunk.map(async (src) => {
        try {
          const result = await firecrawl.scrape(src.url, {
            formats: ['images'],
          });

          const images = (result as Record<string, unknown>).images as string[] | undefined;
          const photo = images ? pickBestPhoto(images) : null;

          if (photo) {
            await prisma.propertySource_.update({
              where: { id: src.id },
              data: { photos: [photo] },
            });
            updated++;
            process.stdout.write('✅');
          } else {
            failed++;
            process.stdout.write('·');
          }
        } catch {
          failed++;
          process.stdout.write('✗');
        }
      }),
    );

    process.stdout.write('\n');

    if (i + CONCURRENCY < noPhotos.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n✅ Concluído: ${updated} fotos encontradas, ${failed} sem resultado`);
  await prisma.$disconnect();
})().catch((err) => {
  console.error('\n❌ Falhou:', err);
  process.exit(1);
});
