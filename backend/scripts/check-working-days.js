/**
 * Which days payroll thinks are working days, and whether anybody agrees.
 *
 * generatePayslips derives the month's working days from Branch.weeklyOffs,
 * defaulting to "0" — Sunday only — when a branch has not set it. That makes
 * Saturday a working day, and every unworked Saturday an unexcused absence
 * charged at a full day's pay.
 *
 * For September 2026 that is four extra "absences" per person before anybody
 * has missed anything. Whether that is right depends on a fact this script
 * cannot know and the database does not record clearly: does the company work
 * Saturdays? So it prints what the config says, what attendance actually shows
 * on Saturdays, and lets the two be compared.
 *
 *   node scripts/check-working-days.js 9 2026
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const MONTH = Number(process.argv[2] || new Date().getMonth() + 1);
const YEAR = Number(process.argv[3] || new Date().getFullYear());
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

(async () => {
  console.log(`Working days — ${MONTH}/${YEAR}\n`);

  const branches = await prisma.branch.findMany({
    select: { id: true, name: true, weeklyOffs: true, _count: { select: { employees: true } } },
  });
  console.log('branch weekly-off config:');
  for (const b of branches) {
    const raw = b.weeklyOffs;
    const offs = (raw || '0').split(',').map((n) => n.trim()).filter(Boolean);
    console.log(`  ${String(b.name).slice(0, 24).padEnd(26)} ${b._count.employees} staff   `
      + `weeklyOffs=${raw === null ? 'NULL (defaults to Sunday only)' : `"${raw}"`}`
      + `  -> off on ${offs.map((d) => DAYS[Number(d)] ?? d).join(', ') || 'nothing'}`);
  }
  const noBranch = await prisma.employee.count({ where: { branchId: null } });
  if (noBranch) console.log(`  (${noBranch} employee(s) have no branch — they also default to Sunday only)`);

  // How the month divides under the default rule.
  const total = new Date(YEAR, MONTH, 0).getDate();
  const counts = {};
  for (let d = 1; d <= total; d++) {
    const dow = new Date(YEAR, MONTH - 1, d).getDay();
    counts[dow] = (counts[dow] || 0) + 1;
  }
  console.log(`\n${MONTH}/${YEAR} has ${total} days: `
    + Object.entries(counts).map(([d, n]) => `${n}×${DAYS[d].slice(0, 3)}`).join('  '));
  console.log(`  Sunday off only  -> ${total - (counts[0] || 0)} working days`);
  console.log(`  Sat + Sun off    -> ${total - (counts[0] || 0) - (counts[6] || 0)} working days`);

  // Does anyone actually turn up on a Saturday? If attendance is near-empty on
  // Saturdays while weekdays are busy, the config is charging people for a day
  // nobody was expected to work.
  const start = new Date(YEAR, MONTH - 1, 1);
  const end = new Date(YEAR, MONTH, 0);
  const rows = await prisma.attendance.findMany({
    where: { date: { gte: start, lte: end }, status: { in: ['PRESENT', 'HALF_DAY'] } },
    select: { date: true },
  });
  const byDow = {};
  for (const r of rows) {
    const dow = new Date(r.date).getUTCDay();
    byDow[dow] = (byDow[dow] || 0) + 1;
  }
  console.log('\nattendance actually recorded, by weekday:');
  for (let d = 0; d < 7; d++) {
    const n = byDow[d] || 0;
    const perDay = counts[d] ? (n / counts[d]).toFixed(1) : '0';
    console.log(`  ${DAYS[d].padEnd(10)} ${String(n).padStart(4)} record(s) across ${counts[d] || 0} ${DAYS[d]}s`
      + `  = ${perDay} people/day`);
  }
  console.log('\nRead-only.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
