/**
 * READ-ONLY. Comp-off credited automatically before the 15 Oct 2026 rule change.
 *
 *   node scripts/report-compoff-2026-10.js
 *
 * The new rule (attendance.service.ts grantCompOffIfEligible): a day off is
 * decided by the person's roster, or fixed shift working days, and Sunday or
 * the branch weekly off only count without either. Comp-off is earned only on
 * an approved field visit that day.
 *
 * Part 1 lists people who work weekends with another day off, from their shift
 * working days and the last 90 days of roster. Part 2 lists every automatic
 * credit (reason ATTENDANCE_DAY_OFF) the new rule would not have given, and
 * why. Manual credits and field-visit credits are left out. Writes nothing.
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ymd = (d) => d.toISOString().slice(0, 10);
const name = (e) => `${e.firstName} ${e.lastName || ''}`.trim();

(async () => {
  console.log('READ-ONLY — nothing is written\n');

  // ── Part 1: who works weekends with a weekday off ──
  const since = new Date(Date.now() - 90 * 86400000);
  const [shiftPeople, rosterRows] = await Promise.all([
    prisma.employee.findMany({
      where: { shift: { workingDays: { not: null } } },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, shift: { select: { name: true, workingDays: true } } },
    }),
    prisma.shiftRosterEntry.findMany({
      where: { date: { gte: since } },
      select: { employeeId: true, date: true, isDayOff: true },
    }),
  ]);

  const people = new Map();
  for (const e of shiftPeople) {
    const days = String(e.shift.workingDays).split(',').map((d) => d.trim());
    if (days.includes(DAY[0]) || days.includes(DAY[6])) {
      const off = DAY.filter((d) => !days.includes(d));
      people.set(e.id, `${name(e)} (#${e.id}${e.employeeCode ? `, ${e.employeeCode}` : ''}) — shift "${e.shift.name}" works ${days.join(',')}; off ${off.join(',') || 'none'}`);
    }
  }
  const rosterBy = new Map();
  for (const r of rosterRows) {
    const s = rosterBy.get(r.employeeId) ?? { sunWork: 0, weekdayOff: new Set() };
    const wd = r.date.getUTCDay();
    if (wd === 0 && !r.isDayOff) s.sunWork++;
    if (r.isDayOff && wd >= 1 && wd <= 5) s.weekdayOff.add(DAY[wd]);
    rosterBy.set(r.employeeId, s);
  }
  const rosterIds = [...rosterBy.entries()].filter(([, s]) => s.sunWork > 0 && s.weekdayOff.size > 0).map(([id]) => id);
  if (rosterIds.length) {
    const emps = await prisma.employee.findMany({ where: { id: { in: rosterIds } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } });
    for (const e of emps) {
      const s = rosterBy.get(e.id);
      const line = `${name(e)} (#${e.id}${e.employeeCode ? `, ${e.employeeCode}` : ''}) — roster: ${s.sunWork} Sunday shift(s) in 90 days; weekday off ${[...s.weekdayOff].join(',')}`;
      people.set(e.id, people.has(e.id) ? `${people.get(e.id)}\n      ${line}` : line);
    }
  }
  console.log(`PART 1 — people who work weekends with a weekday off: ${people.size}`);
  for (const line of people.values()) console.log(`  • ${line}`);

  // ── Part 2: automatic credits the new rule would not give ──
  const credits = await prisma.compOffCredit.findMany({
    where: { reason: 'ATTENDANCE_DAY_OFF' },
    select: {
      id: true, date: true, days: true, year: true, employeeId: true,
      employee: { select: { firstName: true, lastName: true, employeeCode: true } },
    },
    orderBy: [{ employeeId: 'asc' }, { date: 'asc' }],
  });

  const wrong = [];
  for (const c of credits) {
    if (!c.date) continue;
    const onVisit = await prisma.fieldVisitAttendance.findFirst({
      where: { employeeId: c.employeeId, visitDate: c.date, request: { status: { in: ['APPROVED', 'COMPLETED'] } } },
      select: { id: true },
    });
    if (onVisit) continue;
    const roster = await prisma.shiftRosterEntry.findUnique({
      where: { employeeId_date: { employeeId: c.employeeId, date: c.date } },
      select: { isDayOff: true },
    });
    const why = roster && !roster.isDayOff
      ? 'rostered working day (not a day off) and no field visit'
      : 'no approved field visit that day';
    wrong.push({ ...c, why });
  }

  console.log(`\nPART 2 — automatic comp-off credits the new rule would not give: ${wrong.length} of ${credits.length}`);
  let last = null, total = 0, personTotal = 0;
  const flush = () => { if (last) console.log(`      = ${personTotal} day(s)`); };
  for (const w of wrong) {
    if (w.employeeId !== last) {
      flush();
      personTotal = 0;
      last = w.employeeId;
      console.log(`  ${name(w.employee)} (#${w.employeeId}${w.employee.employeeCode ? `, ${w.employee.employeeCode}` : ''})`);
    }
    console.log(`    credit #${w.id}  ${ymd(w.date)} ${DAY[w.date.getUTCDay()]}  ${w.days} day  — ${w.why}`);
    personTotal += w.days;
    total += w.days;
  }
  flush();
  console.log(`\n  Total: ${total} day(s) across ${new Set(wrong.map((w) => w.employeeId)).size} people.`);
  console.log('  Nothing was changed. A separate script will remove them once you confirm.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
