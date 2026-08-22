const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const emp = await prisma.user.findFirst({
    where: { email: 'mohits@ces-pl.com' },
    include: { employee: { include: { resumeLines: true } } }
  });
  console.log(JSON.stringify(emp.employee.resumeLines, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
