import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ include: { employee: true }});
  console.log("Users:", users.map(u => ({ id: u.id, email: u.email, employeeId: u.employee?.id })));

  const attendances = await prisma.attendance.findMany({ orderBy: { date: 'desc' }, take: 10 });
  console.log("Recent Attendances:", attendances);
}

main().catch(console.error).finally(() => prisma.$disconnect());
