/**
 * Mark onboarding Completed for staff who joined long ago (17 Oct 2026).
 *
 *   node scripts/complete-old-onboarding.js            (shows who, changes nothing)
 *   node scripts/complete-old-onboarding.js --apply    (makes the change)
 *
 * Every employee record starts as onboarding PENDING. Staff added directly or
 * by bulk import never go through onboarding, so they sat in the directory as
 * "Pending" for good, and new onboarding checklist items were handed to them
 * too. This marks COMPLETED anyone who joined more than 40 days ago (HR's
 * cut-off) and has no open onboarding task. People with an open task, or no
 * joining date, are listed and left alone.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const DAYS = 40;
const apply = process.argv.includes('--apply');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

(async () => {
  const cutoff = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
  const emps = await prisma.employee.findMany({
    where: { onboardingStatus: { not: 'COMPLETED' } },
    select: {
      id: true, firstName: true, lastName: true, employeeCode: true, joiningDate: true, onboardingStatus: true,
      onboardingTasks: { where: { isCompleted: false }, select: { id: true } },
    },
    orderBy: { joiningDate: 'asc' },
  });
  const name = (e) => `${e.firstName} ${e.lastName ?? ''}`.trim() + (e.employeeCode ? ` (#${e.employeeCode})` : '');
  const day = (d) => (d ? d.toISOString().slice(0, 10) : 'no date');

  const toFix = emps.filter((e) => e.joiningDate && e.joiningDate < cutoff && e.onboardingTasks.length === 0);
  const openTasks = emps.filter((e) => e.joiningDate && e.joiningDate < cutoff && e.onboardingTasks.length > 0);
  const noDate = emps.filter((e) => !e.joiningDate);

  console.log(`\nWill mark COMPLETED (joined before ${day(cutoff)}, no open onboarding task): ${toFix.length}`);
  for (const e of toFix) console.log(`  ${day(e.joiningDate)}  ${e.onboardingStatus.padEnd(11)} ${name(e)}`);
  console.log(`\nLeft alone, still have open onboarding tasks: ${openTasks.length}`);
  for (const e of openTasks) console.log(`  ${day(e.joiningDate)}  ${e.onboardingTasks.length} open  ${name(e)}`);
  console.log(`\nLeft alone, no joining date: ${noDate.length}`);
  for (const e of noDate) console.log(`  ${name(e)}`);

  if (!apply) {
    console.log('\nNothing changed. Run again with --apply to make the change.\n');
  } else if (toFix.length) {
    const r = await prisma.employee.updateMany({ where: { id: { in: toFix.map((e) => e.id) } }, data: { onboardingStatus: 'COMPLETED' } });
    console.log(`\nDone: ${r.count} marked COMPLETED.\n`);
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
