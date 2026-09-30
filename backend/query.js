const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const employees = await prisma.employee.findMany({ where: { firstName: "Mohit" } });
  console.log("Employees named Mohit:", employees.map(e => e.id + " " + e.firstName + " " + e.lastName));
}

main().catch(console.error).finally(() => prisma.$disconnect());
