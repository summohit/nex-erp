const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({
    select: { id: true, name: true, key: true, createdAt: true, startDate: true },
    orderBy: { createdAt: 'asc' }
  });
  console.table(projects);
}
main().finally(() => prisma.$disconnect());
