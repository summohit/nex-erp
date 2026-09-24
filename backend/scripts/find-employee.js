/**
 * Look up an employee by name or email fragment.
 *
 *   node scripts/find-employee.js ahmed
 *   node scripts/find-employee.js qudsia
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const q = process.argv[2];
if (!q) { console.error('usage: node scripts/find-employee.js <name-or-email fragment>'); process.exit(1); }

(async () => {
  const like = { contains: q, mode: 'insensitive' };
  const employees = await prisma.employee.findMany({
    where: { OR: [{ firstName: like }, { lastName: like }, { user: { email: like } }] },
    select: {
      id: true, firstName: true, lastName: true,
      user: { select: { email: true, status: true } },
    },
    take: 25,
  });

  if (!employees.length) { console.log(`no employee matches "${q}"`); return; }
  console.log(`${employees.length} match(es) for "${q}":\n`);
  for (const e of employees) {
    console.log(`  emp ${String(e.id).padEnd(5)} ${`${e.firstName} ${e.lastName}`.padEnd(28)} ${e.user?.email ?? '(no user)'}`);
  }
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
