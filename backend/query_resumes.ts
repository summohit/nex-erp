import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const resumes = await prisma.employeeResume.findMany();
  console.log(resumes);
}
main().catch(console.error).finally(() => prisma.$disconnect());
