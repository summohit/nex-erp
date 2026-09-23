/**
 * Repair shift #6, then re-score the day it was mis-scoring.
 *
 * "Onsite Project" reads 00:15 → 00:00 with a 127-minute buffer, so its window
 * shuts at 02:22 and every arrival during working hours counted as late. That
 * is not a rule anybody wrote; it is a broken record, and it has been marking
 * all thirteen people on the shift late on every day they worked.
 *
 * This sets it to the hours the rest of the company keeps (09:30-18:30,
 * buffer 1) and recomputes isLate for TODAY only, for the people on that
 * shift. Earlier days are deliberately left alone -- correcting them is a
 * separate decision, and the count is large.
 *
 * It also fills in Attendance.shiftId where today's row has none. That field
 * exists to record what a day was judged against, and rows written by the
 * backfill script had nothing in it, which leaves a late mark unexplainable.
 *
 *   node scripts/fix-onsite-shift-and-late.js            # dry run
 *   node scripts/fix-onsite-shift-and-late.js --apply
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const APPLY = process.argv.includes('--apply');
const SHIFT_ID = 6;
const FIXED = { startTime: '09:30', endTime: '18:30', bufferTimeMinutes: 1 };
const DAY = '2026-09-23';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const dateKey = new Date(`${DAY}T00:00:00.000Z`);
const hhmm = (d) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);
const latestAllowed = (startTime, buffer) => {
  const [h, m] = startTime.split(':').map(Number);
  const [y, mo, d] = DAY.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - IST_OFFSET_MS + (buffer ?? 0) * 60000);
};

(async () => {
  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);

  const shift = await prisma.shift.findUnique({ where: { id: SHIFT_ID } });
  if (!shift) { console.error(`no shift #${SHIFT_ID}`); process.exit(1); }
  const staff = await prisma.employee.count({ where: { shiftId: SHIFT_ID } });

  console.log(`shift #${SHIFT_ID} "${shift.name}" — ${staff} people`);
  console.log(`  before: ${shift.startTime} → ${shift.endTime}  buffer ${shift.bufferTimeMinutes}m `
    + `(window shuts ${hhmm(latestAllowed(shift.startTime, shift.bufferTimeMinutes))})`);
  console.log(`  after : ${FIXED.startTime} → ${FIXED.endTime}  buffer ${FIXED.bufferTimeMinutes}m `
    + `(window shuts ${hhmm(latestAllowed(FIXED.startTime, FIXED.bufferTimeMinutes))})`);

  // Re-score today for this shift's people only. Everyone else was judged
  // against a shift that was never wrong, and re-scoring them would risk
  // overwriting a verdict a roster override made correctly.
  const rows = await prisma.attendance.findMany({
    where: { date: dateKey, clockIn: { not: null }, employee: { shiftId: SHIFT_ID } },
    select: { id: true, clockIn: true, isLate: true, shiftId: true,
              employee: { select: { firstName: true, lastName: true } } },
    orderBy: { clockIn: 'asc' },
  });

  console.log(`\n${DAY}: ${rows.length} of them clocked in\n`);
  const cutoff = latestAllowed(FIXED.startTime, FIXED.bufferTimeMinutes);
  const changes = [];
  for (const r of rows) {
    const name = `${r.employee.firstName} ${r.employee.lastName}`;
    const should = r.clockIn > cutoff;
    const flagMoves = should !== r.isLate;
    const needsShiftId = r.shiftId == null;
    if (flagMoves || needsShiftId) changes.push({ ...r, name, should });
    console.log(`  ${hhmm(r.clockIn).padEnd(6)} ${name.slice(0, 24).padEnd(26)}`
      + `${(r.isLate ? 'LATE' : 'on time').padEnd(9)}`
      + `${flagMoves ? `→ ${should ? 'LATE' : 'on time'}` : '(unchanged)'}`
      + `${needsShiftId ? '  +shiftId' : ''}`);
  }

  // Today's rows the backfill wrote have no shiftId at all, whatever shift
  // their owner is on. A late mark with nothing recorded beside it cannot be
  // explained to the person it belongs to.
  const missing = await prisma.attendance.findMany({
    where: { date: dateKey, clockIn: { not: null }, shiftId: null, employee: { shiftId: { not: null } } },
    select: { id: true, employee: { select: { firstName: true, lastName: true, shiftId: true } } },
  });
  console.log(`\nrows missing shiftId across the whole day: ${missing.length}`);

  console.log(`\n  late flags moving : ${changes.filter((c) => c.should !== c.isLate).length}`);
  console.log(`  shiftId to fill   : ${missing.length}`);

  if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

  await prisma.shift.update({ where: { id: SHIFT_ID }, data: FIXED });
  console.log(`\n  shift #${SHIFT_ID} repaired`);

  for (const c of changes.filter((x) => x.should !== x.isLate)) {
    await prisma.attendance.update({ where: { id: c.id }, data: { isLate: c.should } });
    console.log(`  ${c.name}: ${c.isLate ? 'LATE' : 'on time'} → ${c.should ? 'LATE' : 'on time'}`);
  }

  for (const m of missing) {
    await prisma.attendance.update({ where: { id: m.id }, data: { shiftId: m.employee.shiftId } });
  }
  console.log(`  filled shiftId on ${missing.length} row(s)`);
  console.log(`\nDone. ${staff} people now score against real hours from tomorrow.`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
