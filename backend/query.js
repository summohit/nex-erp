const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const emps = await prisma.employee.findMany({
    include: { user: true, department: true }
  });
  emps.forEach(e => {
    console.log(`${e.firstName} ${e.lastName}: ${e.department?.name} | Role: ${e.user?.role}`);
  });
}
main().catch(console.error).finally(() => prisma.$disconnect());
