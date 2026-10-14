/**
 * Amit Kumar's onsite days, 3 and 5–9 October 2026.
 *
 * He was deployed at PNB Delhi (ACI Implementation Project). His standing shift
 * is "Onsite Project", but these six days were scored against the office
 * General Shift and every one came out HALF_DAY — late against an office start,
 * or "left early" against an office end. A HALF_DAY counts 0.5 in payroll, so
 * this was three days' pay. Approving a regularization could not fix it,
 * because approval never re-scored the day (fixed separately in
 * AttendanceService.resolveRegularization).
 *
 *   node scripts/fix-amit-kumar-onsite-2026-10.js            # dry run, writes nothing
 *   node scripts/fix-amit-kumar-onsite-2026-10.js --apply    # writes
 *
 * Each day becomes PRESENT, not late, not an early leave, onsite, on the
 * Onsite Project shift. Clock times are left exactly as recorded, and so are
 * the out-of-office geofence flags — those are an administrator's decision.
 *
 * Only a row that is still this person's, on the expected date, and still
 * HALF_DAY is touched; anything else is reported and nothing is written.
 * Re-running is safe: a corrected day is skipped as already right.
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

const EMPLOYEE_ID = 28;        // Amit Kumar, code 20220
const EMPLOYEE_CODE = '20220';
const ONSITE_SHIFT_ID = 6;     // "Onsite Project", 09:30–18:30, no office geofence

/** [attendance id, date] as read from production on 14 Oct 2026. */
const DAYS = [
  [51238, '2026-10-03'],
  [51275, '2026-10-05'],
  [51312, '2026-10-06'],
  [51351, '2026-10-07'],
  [51379, '2026-10-08'],
  [51430, '2026-10-09'],
];

const FIX = { status: 'PRESENT', isLate: false, isEarlyLeave: false, isOnsite: true, shiftId: ONSITE_SHIFT_ID };

(async () => {
  const emp = await prisma.employee.findUnique({
    where: { id: EMPLOYEE_ID },
    select: { id: true, employeeCode: true, firstName: true, lastName: true },
  });
  if (!emp || emp.employeeCode !== EMPLOYEE_CODE) {
    console.error(`ERROR: employee ${EMPLOYEE_ID} is not code ${EMPLOYEE_CODE} — stopping.`);
    process.exit(1);
  }
  const shift = await prisma.shift.findUnique({ where: { id: ONSITE_SHIFT_ID }, select: { name: true } });
  if (shift?.name !== 'Onsite Project') {
    console.error(`ERROR: shift ${ONSITE_SHIFT_ID} is "${shift?.name}", expected "Onsite Project" — stopping.`);
    process.exit(1);
  }

  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'} · ${emp.firstName} ${emp.lastName} (${emp.employeeCode})\n`);

  const plan = [];
  for (const [id, day] of DAYS) {
    const row = await prisma.attendance.findUnique({
      where: { id },
      select: { id: true, employeeId: true, date: true, status: true, isLate: true, isEarlyLeave: true, isOnsite: true, shiftId: true },
    });
    if (!row) { plan.push({ id, day, action: 'MISSING', detail: 'no such attendance row' }); continue; }
    const rowDay = row.date.toISOString().slice(0, 10);
    if (row.employeeId !== EMPLOYEE_ID || rowDay !== day) {
      plan.push({ id, day, action: 'BLOCKED', detail: `row is employee ${row.employeeId} on ${rowDay}` });
      continue;
    }
    if (Object.entries(FIX).every(([k, v]) => row[k] === v)) {
      plan.push({ id, day, action: 'NO-OP', detail: 'already corrected' });
      continue;
    }
    if (row.status !== 'HALF_DAY') {
      plan.push({ id, day, action: 'BLOCKED', detail: `status is ${row.status}, not HALF_DAY — check by hand` });
      continue;
    }
    const was = `${row.status} late=${row.isLate} early=${row.isEarlyLeave} onsite=${row.isOnsite} shift=${row.shiftId}`;
    plan.push({ id, day, action: 'FIX', detail: `${was}  →  PRESENT late=false early=false onsite=true shift=${ONSITE_SHIFT_ID}` });
  }

  for (const p of plan) console.log(`  ${p.action.padEnd(8)} ${p.day}  #${p.id}  ${p.detail}`);

  const toFix = plan.filter((p) => p.action === 'FIX');
  const problems = plan.filter((p) => p.action === 'MISSING' || p.action === 'BLOCKED');
  console.log(`\n  to fix        : ${toFix.length}`);
  console.log(`  already right : ${plan.filter((p) => p.action === 'NO-OP').length}`);
  console.log(`  blocked       : ${problems.length}`);

  if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }
  if (problems.length) { console.error('\nERROR: blocked or missing rows above — nothing written.'); process.exit(1); }

  // All six or none: a half-corrected month is harder to explain than either.
  await prisma.$transaction(toFix.map((p) => prisma.attendance.update({ where: { id: p.id }, data: FIX })));
  console.log(`\nDone. ${toFix.length} day(s) now PRESENT for ${emp.firstName} ${emp.lastName}.`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
