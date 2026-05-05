// AUTH-1: Dev seed — 1 agency + 1 owner + 3 brokers
// Run: pnpm exec prisma db seed
import { PrismaClient, UserRole, UserPlan } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create owner first (agency FK is applied after)
  const owner = await prisma.user.upsert({
    where: { email: 'owner@propmatch.dev' },
    update: {},
    create: {
      email: 'owner@propmatch.dev',
      name: 'Owner Dev',
      passwordHash: '$argon2id$placeholder',
      role: UserRole.owner,
      plan: UserPlan.pro,
      lgpdConsentAt: new Date(),
    },
  });

  const agency = await prisma.agency.upsert({
    where: { ownerUserId: owner.id },
    update: {},
    create: {
      name: 'Imobiliária Dev',
      seatCount: 10,
      ownerUserId: owner.id,
    },
  });

  // Link owner to agency
  await prisma.user.update({
    where: { id: owner.id },
    data: { agencyId: agency.id },
  });

  const brokerEmails = [
    { email: 'broker1@propmatch.dev', name: 'Broker Um' },
    { email: 'broker2@propmatch.dev', name: 'Broker Dois' },
    { email: 'broker3@propmatch.dev', name: 'Broker Três' },
  ];

  for (const b of brokerEmails) {
    await prisma.user.upsert({
      where: { email: b.email },
      update: {},
      create: {
        email: b.email,
        name: b.name,
        passwordHash: '$argon2id$placeholder',
        role: UserRole.broker,
        plan: UserPlan.free,
        lgpdConsentAt: new Date(),
        agencyId: agency.id,
      },
    });
  }

  console.log('Seed concluído: 1 agência, 1 owner, 3 brokers.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
