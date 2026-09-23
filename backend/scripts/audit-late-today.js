/**
 * Every late mark for a day, and whether the shift behind it is believable.
 *
 * A late flag is only as good as the shift it was scored against. Two people
 * are on a shift reading "starts 00:15, buffer 127m", which marks a 09:22
 * arrival late -- so the flag says more about the shift record than about when
 * anybody turned up. This prints both, side by side, and says which verdicts
 * would change if the person were scored against the shift most of the
 * company is on.
 *
 *   node scripts/audit-late-today.js              # today
 *   node scripts/audit-late-today.js 2026-09-23   # a given day
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
const hhmm = (d) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);

/** The instant a shift's window closes on DAY, buffer included. */
const latestAllowed = (startTime, buffer) => {
  const [h, m] = startTime.split(':').map(Number);
  const [y, mo, d] = DAY.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - IST_OFFSET_MS + (buffer ?? 0) * 60000);
};

(async () => {
  const shifts = await prisma.shift.findMany({ orderBy: { id: 'asc' } });
  const headcount = new Map();
  for (const s of shifts) headcount.set(s.id, await prisma.employee.count({ where: { shiftId: s.id } }));

  console.log(`shifts on file:\n`);
  for (const s of shifts) {
    console.log(`  #${String(s.id).padEnd(3)} ${String(s.name).slice(0, 26).padEnd(28)} `
      + `${String(s.startTime ?? '—').padEnd(6)}→ ${String(s.endTime ?? '—').padEnd(6)} `
      + `buffer ${String(s.bufferTimeMinutes ?? 0).padEnd(5)} ${headcount.get(s.id)} people`);
  }

  // The shift the company actually runs on: the one with the most people.
  const main = [...shifts].sort((a, b) => headcount.get(b.id) - headcount.get(a.id))[0];
  console.log(`\nmost-used shift: #${main.id} "${main.name}" ${main.startTime}+${main.bufferTimeMinutes ?? 0}m`);

  const rows = await prisma.attendance.findMany({
    where: { date: dateKey, clockIn: { not: null } },
    select: {
      id: true, clockIn: true, isLate: true,
      employee: { select: { firstName: true, lastName: true, shift: true } },
    },
  });

  console.log(`\n${DAY}: ${rows.length} people with a clock-in, ${rows.filter((r) => r.isLate).length} marked late\n`);

  const wrong = [];
  for (const r of rows.sort((a, b) => a.clockIn - b.clockIn)) {
    const s = r.employee.shift;
    const name = `${r.employee.firstName} ${r.employee.lastName}`;

    const ownVerdict = s?.startTime ? r.clockIn > latestAllowed(s.startTime, s.bufferTimeMinutes) : false;
    const mainVerdict = r.clockIn > latestAllowed(main.startTime, main.bufferTimeMinutes);
    const disagrees = r.isLate !== mainVerdict;

    const shiftLabel = s?.startTime ? `${s.startTime}+${s.bufferTimeMinutes ?? 0}m` : 'NO SHIFT';
    const mark = disagrees ? '  ←' : '';
    console.log(`  ${hhmm(r.clockIn).padEnd(6)} ${name.slice(0, 24).padEnd(26)} `
      + `${(r.isLate ? 'LATE' : 'on time').padEnd(8)} vs ${shiftLabel.padEnd(12)}`
      + `${disagrees ? `would be ${mainVerdict ? 'LATE' : 'on time'} on the main shift` : ''}${mark}`);

    if (disagrees) wrong.push({ id: r.id, name, clockIn: r.clockIn, was: r.isLate, should: mainVerdict, shiftLabel });
    if (ownVerdict !== r.isLate) console.log(`         ^ stored flag disagrees with its own shift too`);
  }

  console.log(`\n  ${wrong.length} flag(s) disagree with the main shift:`);
  for (const w of wrong) console.log(`    ${w.name}: ${w.was ? 'LATE' : 'on time'} → ${w.should ? 'LATE' : 'on time'}  (scored vs ${w.shiftLabel})`);
  console.log('\nRead-only. Nothing was changed.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
