/**
 * Everyone with no shift assigned, and optionally puts them on the General Shift.
 *
 * A shift is what a day is judged against. With none, a person is never late,
 * never leaves early and never earns overtime -- they read as flawlessly
 * punctual because nothing is being measured. That is the quiet opposite of
 * the "Onsite Project" shift, which marked thirteen people late every day.
 *
 * Only people who are actually working are assigned. Somebody still onboarding
 * has no days to score yet, and somebody separated should not be given a shift
 * on their way out; both are listed, and both are left alone.
 *
 *   node scripts/list-employees-without-shift.js            # dry run
 *   node scripts/list-employees-without-shift.js --apply    # assign
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
const TARGET_SHIFT_ID = 1; // General Shift, 09:30-18:30

(async () => {
  const shift = await prisma.shift.findUnique({ where: { id: TARGET_SHIFT_ID } });
  if (!shift) { console.error(`no shift #${TARGET_SHIFT_ID}`); process.exit(1); }

  const total = await prisma.employee.count();
  const none = await prisma.employee.findMany({
    where: { shiftId: null },
    select: {
      id: true, firstName: true, lastName: true, employeeCode: true,
      employmentType: true, onboardingStatus: true, offboardingStatus: true,
      user: { select: { email: true, status: true } },
      _count: { select: { attendances: true } },
    },
    orderBy: { id: 'asc' },
  });

  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}`);
  console.log(`target: shift #${shift.id} "${shift.name}" ${shift.startTime}-${shift.endTime} buffer ${shift.bufferTimeMinutes}m\n`);
  console.log(`${none.length} of ${total} employees have no shift\n`);

  const assign = [];
  for (const e of none) {
    const leaving = e.offboardingStatus && e.offboardingStatus !== 'NONE';
    const joining = e.onboardingStatus && e.onboardingStatus !== 'COMPLETED';
    const suspended = e.user && e.user.status !== 'ACTIVE';

    // Attendance history outranks the onboarding flag. Ashish Sharma has 638
    // days recorded and still reads as PENDING -- nobody ever ticked the box.
    // Somebody who has been coming to work for two years is working, and a
    // shift is exactly what those days should have been scored against.
    const working = e._count.attendances > 0;

    const why = leaving ? `leaving (${e.offboardingStatus})`
              : suspended ? `user ${e.user.status}`
              : joining && !working ? `joining (${e.onboardingStatus}), no days yet`
              : null;

    const action = why ? 'SKIP' : 'ASSIGN';
    if (!why) assign.push(e);

    console.log(`  ${action.padEnd(7)} emp ${String(e.id).padEnd(5)} `
      + `${`${e.firstName} ${e.lastName}`.slice(0, 24).padEnd(26)}`
      + `${String(e.user?.email ?? '(no user)').slice(0, 30).padEnd(32)}`
      + `${String(e.employmentType ?? '—').padEnd(12)} ${String(e._count.attendances).padStart(4)} day(s)`
      + `${why ? `  — ${why}` : ''}`);
  }

  console.log(`\n  assign : ${assign.length}`);
  console.log(`  skip   : ${none.length - assign.length}`);

  if (!APPLY) { console.log('\nRe-run with --apply to assign.'); return; }
  if (!assign.length) { console.log('\nNothing to do.'); return; }

  const { count } = await prisma.employee.updateMany({
    where: { id: { in: assign.map((e) => e.id) } },
    data: { shiftId: TARGET_SHIFT_ID },
  });
  console.log(`\nAssigned ${count} employee(s) to "${shift.name}".`);
  console.log('Their days are scored from tomorrow; today was already written.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
