/**
 * Put a whole period's payslips back to DRAFT (19 Oct 2026), after the whole
 * of October 2026 was marked paid during a test. Employees only see FINALIZED
 * and PAID slips, so DRAFT hides them again. Clears the payment date.
 *
 *   node scripts/revert-period-to-draft.js <month> <year>           (shows counts, changes nothing)
 *   node scripts/revert-period-to-draft.js <month> <year> --apply   (reverts)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const [month, year] = process.argv.slice(2).map(Number);
const apply = process.argv.includes('--apply');
if (!month || !year) { console.log('Usage: node scripts/revert-period-to-draft.js <month> <year> [--apply]'); process.exit(1); }
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

(async () => {
  const where = { month, year, status: { in: ['FINALIZED', 'PAID'] } };
  const counts = await prisma.payslip.groupBy({ by: ['status'], where: { month, year }, _count: true });
  console.log(`\n${month}/${year} payslips now:`, counts.map((c) => `${c.status} ${c._count}`).join(', ') || 'none');
  const n = await prisma.payslip.count({ where });
  if (!apply) console.log(`\nWould put ${n} back to DRAFT. Nothing changed. Add --apply to do it.\n`);
  else {
    const r = await prisma.payslip.updateMany({ where, data: { status: 'DRAFT', paidOn: null } });
    console.log(`\nDone: ${r.count} back to DRAFT, payment dates cleared.\n`);
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
