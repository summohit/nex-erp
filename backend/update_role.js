const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const updatedUser = await prisma.user.update({
    where: { email: 'mohits@ces-pl.com' },
    data: { role: 'ADMIN' }
  });
  console.log("Updated mohits@ces-pl.com to:", updatedUser.role);
}

main().finally(() => prisma.$disconnect());
