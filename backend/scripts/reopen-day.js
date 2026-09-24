/**
 * Collapse a day into a single open session starting at a given time.
 *
 * For someone whose day came out of the outage in pieces: a punch at 10:00
 * that closed a second later, another at 10:01, a start moved back to 09:03 by
 * the backfill, and a total of 58 minutes marked Half Day. None of that
 * describes the day they worked. It describes a button that would not work.
 *
 * This replaces those sessions with one that starts when they arrived and has
 * not ended, so the evening's clock-out lands normally and scores the day the
 * ordinary way.
 *
 *   node scripts/reopen-day.js someone@example.com 09:03
 *   node scripts/reopen-day.js someone@example.com 09:03 --apply
 *
 * DESTRUCTIVE: the fragments are deleted, not kept alongside. They are printed
 * in full first, because a punch record is somebody's evidence of their day
 * and deleting one unseen is not a thing to do quietly.
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const [EMAIL, TIME] = args;
const DAY = args[2] || new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

if (!EMAIL || !/^\d{2}:\d{2}$/.test(TIME ?? '')) {
  console.error('usage: node scripts/reopen-day.js <email> <HH:MM> [YYYY-MM-DD] [--apply]');
  process.exit(1);
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const dateKey = new Date(`${DAY}T00:00:00.000Z`);
const hhmm = (d) => (d ? new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16) : 'open');
const istInstant = (t) => {
  const [h, m] = t.split(':').map(Number);
  const [y, mo, d] = DAY.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - IST_OFFSET_MS);
};

(async () => {
  const user = await prisma.user.findFirst({
    where: { email: { equals: EMAIL, mode: 'insensitive' } },
    select: { employee: { select: { id: true, firstName: true, lastName: true, shift: true } } },
  });
  const emp = user?.employee;
  if (!emp) { console.error(`no employee for ${EMAIL}`); process.exit(1); }

  const row = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: emp.id, date: dateKey } },
    include: { logs: { orderBy: { clockIn: 'asc' } } },
  });
  if (!row) { console.error(`${emp.firstName} has no attendance row for ${DAY}`); process.exit(1); }

  const clockIn = istInstant(TIME);
  let isLate = false;
  let against = 'no shift on file';
  if (emp.shift?.startTime) {
    const [sh, sm] = emp.shift.startTime.split(':').map(Number);
    const [y, mo, d] = DAY.split('-').map(Number);
    const buffer = emp.shift.bufferTimeMinutes ?? 0;
    isLate = clockIn > new Date(Date.UTC(y, mo - 1, d, sh, sm) - IST_OFFSET_MS + buffer * 60000);
    against = `${emp.shift.startTime}+${buffer}m`;
  }

  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`${emp.firstName} ${emp.lastName} · ${DAY}`);
  console.log(`\n  before: clockIn ${hhmm(row.clockIn)}  clockOut ${row.clockOut ? hhmm(row.clockOut) : '—'}`
    + `  status ${row.status}  late ${row.isLate}  early ${row.isEarlyLeave}  overtime ${row.overtimeHours}`);
  console.log(`  ${row.logs.length} session(s) to be REMOVED:`);
  for (const l of row.logs) {
    const mins = l.clockOut ? Math.round((l.clockOut - l.clockIn) / 60000) : null;
    console.log(`    #${String(l.id).padEnd(6)} ${hhmm(l.clockIn)} → ${hhmm(l.clockOut)}${mins !== null ? `  (${mins}m)` : ''}`);
  }
  console.log(`\n  after : one open session from ${TIME}`);
  console.log(`          status PRESENT  late ${isLate} (vs ${against})  early false  overtime 0`);

  if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

  await prisma.$transaction([
    prisma.attendanceLog.deleteMany({ where: { attendanceId: row.id } }),
    prisma.attendanceLog.create({ data: { attendanceId: row.id, clockIn } }),
    prisma.attendance.update({
      where: { id: row.id },
      data: {
        clockIn,
        clockOut: null,
        clockOutLat: null,
        clockOutLng: null,
        status: 'PRESENT',
        isLate,
        isEarlyLeave: false,
        overtimeHours: 0,
        autoClockedOut: false,
        missedClockOut: false,
        shiftId: row.shiftId ?? emp.shift?.id ?? null,
      },
    }),
  ]);

  console.log(`\nDone. ${emp.firstName} is clocked in from ${TIME} and can clock out normally.`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
