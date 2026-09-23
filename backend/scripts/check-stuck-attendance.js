/**
 * Read-only: how many attendance days were caught by the clock-in deadlock.
 *
 * A day counts as "still open" in two different places, and until the fix they
 * disagreed. Clock-in asked the parent row (clockIn set, clockOut null) and
 * clock-out asked the logs (is any log still running). A row that answered yes
 * to the first and no to the second trapped its owner: clock-in refused,
 * naming the day, and the clock-out it offered replied "Already clocked out".
 *
 * Rows like that come from anything that writes the parent row without logs --
 * the Workway import, an approved regularization -- so they are ordinary, and
 * this counts them. After the fix they no longer block anything; they are
 * simply days missing a clock-out, which regularization corrects.
 *
 *   node scripts/check-stuck-attendance.js
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Same driver adapter the app and the import script use; Prisma 7 has no
// default connection of its own.
const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

(async () => {
  const open = await prisma.attendance.findMany({
    where: { clockIn: { not: null }, clockOut: null },
    select: {
      id: true, date: true, employeeId: true, clockIn: true, missedClockOut: true,
      employee: { select: { firstName: true, lastName: true } },
      logs: { select: { clockOut: true } },
    },
    orderBy: { date: 'desc' },
  });

  const running = open.filter((a) => a.logs.some((l) => !l.clockOut));
  const stuck = open.filter((a) => !a.logs.some((l) => !l.clockOut));

  console.log(`parent rows with a clock-in and no clock-out : ${open.length}`);
  console.log(`  genuinely running (an open log)            : ${running.length}`);
  console.log(`  was deadlocking its owner (no open log)    : ${stuck.length}`);
  console.log(`    of those, no logs at all (imported)      : ${stuck.filter((a) => !a.logs.length).length}`);

  const blocked = new Map();
  for (const a of stuck) {
    const name = `${a.employee?.firstName ?? ''} ${a.employee?.lastName ?? ''}`.trim() || `employee ${a.employeeId}`;
    if (!blocked.has(a.employeeId)) blocked.set(a.employeeId, { name, days: [] });
    blocked.get(a.employeeId).days.push(a.date.toISOString().slice(0, 10));
  }
  console.log(`\npeople who could not clock in: ${blocked.size}`);
  for (const { name, days } of blocked.values()) {
    console.log(`  ${name}: ${days.slice(0, 6).join(', ')}${days.length > 6 ? ` (+${days.length - 6} more)` : ''}`);
  }
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
