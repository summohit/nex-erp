/**
 * Which shift each of these people is on, and how many share it.
 *
 * Two of them score against "00:15 + 127m", which is not a working day anybody
 * keeps -- it marks a 09:22 arrival late. Worth seeing before it is applied.
 *
 *   node scripts/show-shifts.js
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const EMAILS = ['gauravn@ces-pl.com', 'ayushmaansinght@gmail.com', 'ashishs@ces-pl.com'];

(async () => {
  for (const email of EMAILS) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { employee: { select: { id: true, firstName: true, lastName: true, shift: true } } },
    });
    const e = user?.employee;
    if (!e) { console.log(`${email}: no employee`); continue; }
    const s = e.shift;
    console.log(`\n${e.firstName} ${e.lastName}  (${email})`);
    console.log(s
      ? `  shift #${s.id} "${s.name}"  start ${s.startTime ?? '—'}  end ${s.endTime ?? '—'}  buffer ${s.bufferTimeMinutes ?? 0}m  halfDay ${s.halfDayTime ?? '—'}`
      : '  no shift assigned — never scored late');
    if (s) {
      const shared = await prisma.employee.count({ where: { shiftId: s.id } });
      console.log(`  ${shared} employee(s) on this shift`);
    }
  }

  console.log('\nAll shifts on file:');
  for (const s of await prisma.shift.findMany({ orderBy: { id: 'asc' } })) {
    const n = await prisma.employee.count({ where: { shiftId: s.id } });
    console.log(`  #${String(s.id).padEnd(3)} ${String(s.name).padEnd(28)} ${String(s.startTime ?? '—').padEnd(6)}→ ${String(s.endTime ?? '—').padEnd(6)} buffer ${String(s.bufferTimeMinutes ?? 0).padEnd(4)} ${n} people`);
  }
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
