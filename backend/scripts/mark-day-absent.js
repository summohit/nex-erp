/**
 * Mark a day absent, clearing the punches on it.
 *
 * For a day where the only thing recorded is a test: a clock-in and clock-out
 * a second apart, left behind while checking whether the button worked. The
 * person was not at work, so PRESENT with 0 minutes is the wrong record and
 * HALF_DAY is worse -- it reads as somebody who came in and left.
 *
 *   node scripts/mark-day-absent.js someone@example.com
 *   node scripts/mark-day-absent.js someone@example.com 2026-09-23 --apply
 *
 * DESTRUCTIVE: the day's sessions are deleted. They are printed first.
 *
 * This records absence, not leave. If the day should be paid leave, that is a
 * leave request and this does not stand in for one.
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
const EMAIL = args[0];
const DAY = args[1] || new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

if (!EMAIL) {
  console.error('usage: node scripts/mark-day-absent.js <email> [YYYY-MM-DD] [--apply]');
  process.exit(1);
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const dateKey = new Date(`${DAY}T00:00:00.000Z`);
const hhmm = (d) => (d ? new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16) : 'open');

(async () => {
  const user = await prisma.user.findFirst({
    where: { email: { equals: EMAIL, mode: 'insensitive' } },
    select: { employee: { select: { id: true, firstName: true, lastName: true } } },
  });
  const emp = user?.employee;
  if (!emp) { console.error(`no employee for ${EMAIL}`); process.exit(1); }

  const row = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: emp.id, date: dateKey } },
    include: { logs: { orderBy: { clockIn: 'asc' } } },
  });
  if (!row) { console.log(`${emp.firstName} has no attendance row for ${DAY} — already absent by omission.`); return; }

  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`${emp.firstName} ${emp.lastName} · ${DAY}`);
  console.log(`\n  before: clockIn ${hhmm(row.clockIn)}  clockOut ${row.clockOut ? hhmm(row.clockOut) : '—'}  status ${row.status}`);
  console.log(`  ${row.logs.length} session(s) to be REMOVED:`);
  for (const l of row.logs) {
    const mins = l.clockOut ? Math.round((l.clockOut - l.clockIn) / 60000) : null;
    console.log(`    #${String(l.id).padEnd(6)} ${hhmm(l.clockIn)} → ${hhmm(l.clockOut)}${mins !== null ? `  (${mins}m)` : ''}`);
  }
  console.log(`\n  after : status ABSENT, no clock-in, no sessions`);

  if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

  await prisma.$transaction([
    prisma.attendanceLog.deleteMany({ where: { attendanceId: row.id } }),
    prisma.attendance.update({
      where: { id: row.id },
      data: {
        clockIn: null, clockOut: null,
        clockInLat: null, clockInLng: null, clockOutLat: null, clockOutLng: null,
        status: 'ABSENT',
        isLate: false, isEarlyLeave: false, overtimeHours: 0,
        autoClockedOut: false, missedClockOut: false, clockOutReason: null,
      },
    }),
  ]);

  console.log(`\nDone. ${DAY} is recorded as absent for ${emp.firstName}.`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
