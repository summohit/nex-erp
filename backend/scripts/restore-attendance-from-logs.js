/**
 * Restores clock-in/out that the Workway attendance import overwrote.
 *
 * import-workway-attendance.js upserts status, clockIn and clockOut from
 * Workway. Where Workway held no time -- because the person clocked in through
 * NEX, not Workway -- it wrote null over a real clock-in and set the day
 * ABSENT. Eleven days across three people were lost that way.
 *
 * AttendanceLog keeps every clock session with its coordinates, so the truth
 * survives: earliest clockIn and latest clockOut of the day's sessions, with
 * the GPS from those same sessions.
 *
 *   node scripts/restore-attendance-from-logs.js --from 2026-09-01 --to 2026-09-21 --dry-run
 *   node scripts/restore-attendance-from-logs.js --from 2026-09-01 --to 2026-09-21
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});
const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const DRY = args.includes('--dry-run');
const FROM = val('--from'), TO = val('--to');

async function main() {
  if (!FROM || !TO) { console.log('usage: --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]'); return; }

  const rows = await prisma.attendance.findMany({
    where: {
      date: { gte: new Date(`${FROM}T00:00:00.000Z`), lte: new Date(`${TO}T00:00:00.000Z`) },
      logs: { some: {} },
    },
    select: {
      id: true, date: true, status: true, clockIn: true, clockOut: true,
      clockInLat: true, clockInLng: true,
      employee: { select: { firstName: true, lastName: true } },
      logs: { orderBy: { clockIn: 'asc' },
              select: { clockIn: true, clockOut: true, clockInLat: true, clockInLng: true,
                        clockOutLat: true, clockOutLng: true } },
    },
  });

  const fixes = [];
  for (const a of rows) {
    const first = a.logs[0];
    const withOut = a.logs.filter((l) => l.clockOut);
    const last = withOut.length ? withOut[withOut.length - 1] : null;
    const patch = {};
    if (!a.clockIn && first?.clockIn) patch.clockIn = first.clockIn;
    if (!a.clockOut && last?.clockOut) patch.clockOut = last.clockOut;
    if (!a.clockInLat && first?.clockInLat) { patch.clockInLat = first.clockInLat; patch.clockInLng = first.clockInLng; }
    if (last?.clockOutLat) { patch.clockOutLat = last.clockOutLat; patch.clockOutLng = last.clockOutLng; }
    // Somebody with clock sessions was not absent. Deliberately narrow:
    // ON_LEAVE, HOLIDAY and WEEKLY_OFF are left alone -- working on a day off
    // is a real thing and not this script's business to reclassify.
    if (a.status === 'ABSENT' && first?.clockIn) patch.status = 'PRESENT';
    if (Object.keys(patch).length) fixes.push({ a, patch });
  }

  console.log(`${DRY ? 'DRY RUN\n' : ''}days with clock sessions in window: ${rows.length}`);
  console.log(`days needing restoration          : ${fixes.length}\n`);
  for (const f of fixes) {
    const who = `${f.a.employee.firstName} ${f.a.employee.lastName}`;
    const bits = Object.keys(f.patch).join(', ');
    console.log(`  ${f.a.date.toISOString().slice(0, 10)}  ${who.padEnd(16)} ${f.a.status.padEnd(10)} -> ${bits}`);
  }
  if (DRY || !fixes.length) return;

  let n = 0;
  for (const f of fixes) { await prisma.attendance.update({ where: { id: f.a.id }, data: f.patch }); n++; }
  console.log(`\nrestored ${n} days`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
      .finally(() => prisma.$disconnect());
