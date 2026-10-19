/**
 * Put one payslip back to DRAFT after a test (19 Oct 2026), so its employee
 * can no longer see it (employees only see FINALIZED and PAID slips).
 *
 *   node scripts/revert-payslip-to-draft.js <employeeCode> <month> <year>          (shows it)
 *   node scripts/revert-payslip-to-draft.js <employeeCode> <month> <year> --apply  (reverts it)
 *
 * Clears the payment date too. One slip only, found by employee code.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const [code, month, year] = process.argv.slice(2);
const apply = process.argv.includes('--apply');
if (!code || !month || !year) {
  console.log('Usage: node scripts/revert-payslip-to-draft.js <employeeCode> <month> <year> [--apply]');
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

(async () => {
  const slips = await prisma.payslip.findMany({
    where: { month: Number(month), year: Number(year), employee: { employeeCode: code } },
    select: { id: true, status: true, paidOn: true, netPay: true, employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
  });
  if (slips.length !== 1) {
    console.log(`Expected exactly one payslip for #${code} ${month}/${year}, found ${slips.length}. Nothing changed.`);
  } else {
    const s = slips[0];
    console.log(`\n#${s.employee.employeeCode} ${s.employee.firstName} ${s.employee.lastName ?? ''}  ${month}/${year}`);
    console.log(`  now: ${s.status}, paid on ${s.paidOn ? s.paidOn.toISOString().slice(0, 10) : '—'}, net ₹${s.netPay}`);
    if (!apply) console.log('\nNothing changed. Add --apply to put it back to DRAFT.\n');
    else {
      await prisma.payslip.update({ where: { id: s.id }, data: { status: 'DRAFT', paidOn: null } });
      console.log('\nDone: back to DRAFT, payment date cleared.\n');
    }
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
