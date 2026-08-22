const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const res = await prisma.employee.update({
      where: { id: 1 },
      data: {
        workingDays: ['Monday']
      }
    });
    console.log("Success");
  } catch (err) {
    console.error("Prisma error:", err.message);
  }
}
main().finally(() => prisma.$disconnect());
