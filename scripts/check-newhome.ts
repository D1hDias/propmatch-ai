import { prisma } from '@/server/db/client';

async function main() {
  const site = await prisma.partnerSite.findFirst({ where: { domain: { contains: 'newhome' } } });
  console.log(JSON.stringify(site, null, 2));
  await prisma.$disconnect();
}

main();
