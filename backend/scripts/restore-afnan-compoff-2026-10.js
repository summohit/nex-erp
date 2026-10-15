/**
 * Put back Afnan Ali's comp-off for Sat 10 Oct 2026 (credit #5), removed by
 * remove-wrong-compoff-2026-10.js. He was on a field visit that day, though
 * the system has no approved visit for it.
 *
 *   node scripts/restore-afnan-compoff-2026-10.js            # dry run
 *   node scripts/restore-afnan-compoff-2026-10.js --apply
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
const EMPLOYEE_ID = 47;
const DATE = new Date('2026-10-10T00:00:00.000Z');
const YEAR = 2026;

(async () => {
  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  const emp = await prisma.employee.findUnique({
    where: { id: EMPLOYEE_ID }, select: { firstName: true, lastName: true, companyId: true },
  });
  const existing = await prisma.compOffCredit.findFirst({ where: { employeeId: EMPLOYEE_ID, date: DATE } });
  if (existing) { console.log(`Already there: credit #${existing.id}. Nothing to do.`); return; }

  // The type attendance credits comp-off to (isCompOff), as removal used.
  const leaveType = await prisma.leaveType.findFirst({
    where: { companyId: emp.companyId, isCompOff: true }, select: { id: true, name: true },
  });
  if (!leaveType) throw new Error('No comp-off leave type found');

  const attendance = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: EMPLOYEE_ID, date: DATE } }, select: { id: true },
  });
  const bal = await prisma.leaveBalance.findUnique({
    where: { employeeId_leaveTypeId_year: { employeeId: EMPLOYEE_ID, leaveTypeId: leaveType.id, year: YEAR } },
    select: { allocated: true, used: true },
  });

  console.log(`${emp.firstName} ${emp.lastName || ''} (#${EMPLOYEE_ID}) — add 1 day for 2026-10-10`);
  console.log(`  comp-off ${YEAR}: allotted ${bal?.allocated ?? 0} → ${(bal?.allocated ?? 0) + 1}, used ${bal?.used ?? 0}`);
  console.log(`  linked to attendance ${attendance ? `#${attendance.id}` : '(none)'}`);
  if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

  await prisma.$transaction(async (tx) => {
    await tx.compOffCredit.create({
      data: {
        companyId: emp.companyId, employeeId: EMPLOYEE_ID, leaveTypeId: leaveType.id,
        attendanceId: attendance?.id ?? null, date: DATE, reason: 'ATTENDANCE_DAY_OFF', days: 1, year: YEAR,
      },
    });
    await tx.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId: EMPLOYEE_ID, leaveTypeId: leaveType.id, year: YEAR } },
      create: { employeeId: EMPLOYEE_ID, leaveTypeId: leaveType.id, year: YEAR, allocated: 1 },
      update: { allocated: { increment: 1 } },
    });
  });
  console.log('\nRestored.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
