import { PrismaClient, UserRole, UserPlan } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
};

async function main() {
  const pepper = process.env.ARGON2_PEPPER ?? '';
  const email = 'final_test@propmatch.com.br';
  const plaintext = 'Test@12345';

  const passwordHash = await argon2.hash(plaintext + pepper, ARGON2_OPTIONS);

  // 1. Cria/atualiza o usuário (sem agência ainda)
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: {
      email,
      name: 'Dev User',
      passwordHash,
      role: UserRole.owner,
      plan: UserPlan.pro,
      lgpdConsentAt: new Date(),
    },
  });

  // 2. Cria agência vinculada a esse owner (se ainda não existir)
  const agency = await prisma.agency.upsert({
    where: { ownerUserId: user.id },
    update: {},
    create: {
      name: 'Dev Agency',
      seatCount: 10,
      ownerUserId: user.id,
    },
  });

  // 3. Vincula o usuário à agência
  await prisma.user.update({
    where: { id: user.id },
    data: { agencyId: agency.id },
  });

  console.log(`✅ Usuário pronto: ${user.email} (id: ${user.id})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
