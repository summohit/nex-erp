const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const emp = await prisma.employee.findFirst({
    where: { user: { email: 'mohitsingh@yopmail.com' } }
  });
  if (!emp) { console.log('no emp'); return; }
  const rows = await prisma.attendance.findMany({
    where: { employeeId: emp.id },
    include: { logs: true },
    orderBy: { date: 'desc' },
    take: 1
  });
  console.log(JSON.stringify(rows[0].logs, null, 2));
}
main();
