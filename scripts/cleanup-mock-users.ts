// One-off script: remove mock/seed/test users, keep only real users.
// Run: pnpm exec tsx scripts/cleanup-mock-users.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const KEEP_EMAILS = [
  'diego@propmatch.com.br',
  'final_test@propmatch.com.br',
  'diego_dias@live.com',
  'victor@likidez.com.br',
];

async function main() {
  const mockUsers = await prisma.user.findMany({
    where: { email: { notIn: KEEP_EMAILS } },
    select: { id: true, email: true },
  });

  if (mockUsers.length === 0) {
    console.log('Nenhum usuário mock encontrado.');
    return;
  }

  const ids = mockUsers.map((u) => u.id);
  console.log(`Removendo ${mockUsers.length} usuários mock…`);

  // 1. HitlMetrics (RESTRICT sobre briefingId)
  const briefingIds = (
    await prisma.briefing.findMany({ where: { userId: { in: ids } }, select: { id: true } })
  ).map((b) => b.id);

  if (briefingIds.length > 0) {
    await prisma.hitlMetric.deleteMany({ where: { briefingId: { in: briefingIds } } });
  }

  // 2. Briefings — cascata: BriefingResult, Message (→ ShortLink SET NULL)
  await prisma.briefing.deleteMany({ where: { userId: { in: ids } } });

  // 3. Clients (Messages já deletadas pela cascata acima)
  await prisma.client.deleteMany({ where: { userId: { in: ids } } });

  // 4. RefreshTokens
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });

  // 5. LgpdJobs
  await prisma.lgpdJob.deleteMany({ where: { userId: { in: ids } } });

  // 6. PartnerSites: SET NULL no userId
  await prisma.partnerSite.updateMany({
    where: { userId: { in: ids } },
    data: { userId: null },
  });

  // 7. Desvincular membros das agências mock antes de deletar a agência
  const mockAgencyIds = (
    await prisma.agency.findMany({ where: { ownerUserId: { in: ids } }, select: { id: true } })
  ).map((a) => a.id);

  if (mockAgencyIds.length > 0) {
    await prisma.user.updateMany({
      where: { agencyId: { in: mockAgencyIds } },
      data: { agencyId: null },
    });
    await prisma.agency.deleteMany({ where: { id: { in: mockAgencyIds } } });
  }

  // 8. Usuários mock
  const { count } = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`✓ ${count} usuários removidos.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
