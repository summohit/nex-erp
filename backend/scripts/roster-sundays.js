/**
 * Why Sundays show as working in a month's roster (21 Oct 2026). Read-only.
 *   node scripts/roster-sundays.js 11 2026
 * Lists rostered (non-day-off) entries on Sundays, who created them and when,
 * and shifts whose working days include Sunday.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const [m, y] = process.argv.slice(2).map(Number);
(async () => {
  const from = new Date(Date.UTC(y || 2026, (m || 11) - 1, 1));
  const to = new Date(Date.UTC(y || 2026, m || 11, 1));
  const entries = await prisma.shiftRosterEntry.findMany({
    where: { date: { gte: from, lt: to }, isDayOff: false },
    select: { date: true, createdAt: true, employee: { select: { firstName: true, lastName: true } }, shift: { select: { name: true } } },
  });
  const sundays = entries.filter((e) => e.date.getUTCDay() === 0);
  const byPerson = new Map();
  for (const e of sundays) {
    const k = `${e.employee.firstName} ${e.employee.lastName ?? ''}`.trim();
    const p = byPerson.get(k) ?? { n: 0, shift: e.shift?.name, created: new Set() };
    p.n++; p.created.add(e.createdAt.toISOString().slice(0, 10));
    byPerson.set(k, p);
  }
  console.log(`\nRostered WORKING entries on Sundays in ${m}/${y}: ${sundays.length} (all rostered entries this month: ${entries.length})`);
  for (const [k, p] of byPerson) console.log(`  ${k}: ${p.n} Sundays · shift ${p.shift || '(standing)'} · created on ${[...p.created].join(', ')}`);
  const shifts = await prisma.shift.findMany({ select: { name: true, workingDays: true } });
  console.log('\nShifts and their working days:');
  for (const s of shifts) console.log(`  ${s.name}: ${s.workingDays || '(not set → branch weekly off, Sunday off by default)'}`);
  console.log('');
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
