const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'mohits@ces-pl.com' },
    include: {
      employee: {
        include: {
          designation: true,
          department: true
        }
      }
    }
  });
  console.log(JSON.stringify(user, null, 2));
}
main().finally(() => prisma.$disconnect());
