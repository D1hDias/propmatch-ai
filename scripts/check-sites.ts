import { prisma } from '../src/server/db/client';

async function main() {
  const sites = await prisma.partnerSite.findMany({
    select: { id: true, domain: true, userId: true, active: true, syncStatus: true, listingCount: true },
  });
  console.log('Partner sites no DB:');
  console.log(JSON.stringify(sites, null, 2));

  const users = await prisma.user.findMany({ select: { id: true, email: true }, take: 5 });
  console.log('\nUsuários:');
  console.log(JSON.stringify(users, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
