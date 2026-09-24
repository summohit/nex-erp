/**
 * Every session recorded today, and whether the day is still open.
 *
 * The backfill moved people's start times but left their sessions as it found
 * them. Somebody who had punched in and out while fighting the broken button
 * came out of it with a closed, very short day -- Jayant's read 09:03 to 10:00
 * plus a one-minute second session, 58 minutes, Half Day. They need an open
 * session to clock out of this evening, and this says who does not have one.
 *
 *   node scripts/today-sessions.js              # today
 *   node scripts/today-sessions.js 2026-09-23
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY = process.argv[2] || new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const dateKey = new Date(`${DAY}T00:00:00.000Z`);
const hhmm = (d) => (d ? new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16) : '—');

(async () => {
  const rows = await prisma.attendance.findMany({
    where: { date: dateKey, clockIn: { not: null } },
    select: {
      id: true, clockIn: true, clockOut: true, status: true, isLate: true, isEarlyLeave: true,
      employee: { select: { firstName: true, lastName: true, user: { select: { email: true } } } },
      logs: { select: { id: true, clockIn: true, clockOut: true }, orderBy: { clockIn: 'asc' } },
    },
    orderBy: { clockIn: 'asc' },
  });

  const closed = [];
  console.log(`${DAY}: ${rows.length} people with a clock-in\n`);

  for (const r of rows) {
    const name = `${r.employee.firstName} ${r.employee.lastName}`;
    const open = r.logs.some((l) => !l.clockOut);
    // Minutes actually recorded, so a day that closed after two minutes of
    // fumbling with a broken button is visible as exactly that.
    const mins = r.logs.reduce((t, l) => t + (l.clockOut ? (l.clockOut - l.clockIn) / 60000 : 0), 0);
    const sessions = r.logs.map((l) => `${hhmm(l.clockIn)}-${l.clockOut ? hhmm(l.clockOut) : 'open'}`).join(' ');

    if (!open) closed.push({ ...r, name, mins });

    console.log(`  ${(open ? 'OPEN' : 'CLOSED').padEnd(7)} ${name.slice(0, 22).padEnd(24)}`
      + `${String(r.status).padEnd(10)} ${String(Math.round(mins)).padStart(4)}m  ${sessions}`);
  }

  console.log(`\n  open   : ${rows.length - closed.length}  (can clock out tonight)`);
  console.log(`  closed : ${closed.length}`);
  if (closed.length) {
    console.log('\nclosed days — nothing left to clock out of:');
    for (const c of closed.sort((a, b) => a.mins - b.mins)) {
      console.log(`  ${c.name.padEnd(24)} ${String(Math.round(c.mins)).padStart(4)}m recorded  ${c.status}`
        + `  ${c.employee.user?.email ?? ''}`);
    }
  }
  console.log('\nRead-only.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
