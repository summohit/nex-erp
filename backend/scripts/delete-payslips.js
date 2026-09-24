/**
 * Delete a period's payslips.
 *
 *   node scripts/delete-payslips.js 9 2026
 *   node scripts/delete-payslips.js 9 2026 --apply
 *
 * September 2026's drafts were generated against an attendance record that is
 * only about 60% complete, so they carry ₹15.1 lakh of loss of pay for days
 * people worked — Mohit Singh's reads ₹48,014 against a salary of ₹1,50,000.
 * They are wrong, they are on screen, and leaving them there invites somebody
 * to finalise them.
 *
 * DRAFT only, unless forced. A FINALIZED or PAID slip is a record somebody may
 * have been shown or paid against; deleting one silently is not this script's
 * business, so it refuses and names them. --include-finalized overrides that
 * for the case where a period was finalised in error, and it asks first.
 *
 * PayslipItem rows go with the slip (cascade). A LeaveEncashment keeps its row
 * and loses the link (SetNull), which is deliberate in the schema: the payout
 * happened even if the slip it rode on is gone.
 */
const path = require('path');
const readline = require('readline');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const APPLY = process.argv.includes('--apply');
const INCLUDE_FINALIZED = process.argv.includes('--include-finalized');
const MONTH = Number(args[0]);
const YEAR = Number(args[1]);

if (!MONTH || !YEAR) {
  console.error('usage: node scripts/delete-payslips.js <month> <year> [--apply] [--include-finalized]');
  process.exit(1);
}

const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const ask = (q) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a.trim().toLowerCase()); });
});

(async () => {
  const slips = await prisma.payslip.findMany({
    where: { month: MONTH, year: YEAR },
    select: {
      id: true, status: true, totalEarnings: true, lossOfPay: true, netPay: true,
      employee: { select: { firstName: true, lastName: true } },
      _count: { select: { items: true, encashments: true } },
    },
    orderBy: { netPay: 'desc' },
  });

  console.log(`${APPLY ? 'DELETING' : 'DRY RUN — nothing will be deleted'}`);
  console.log(`${MONTH}/${YEAR}: ${slips.length} payslip(s)\n`);

  if (!slips.length) { console.log('Nothing to delete.'); return; }

  const byStatus = {};
  for (const s of slips) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  for (const [st, n] of Object.entries(byStatus)) console.log(`  ${st.padEnd(10)} ${n}`);

  const protectedSlips = slips.filter((s) => s.status === 'FINALIZED' || s.status === 'PAID');
  const target = INCLUDE_FINALIZED ? slips : slips.filter((s) => s.status === 'DRAFT');

  if (protectedSlips.length && !INCLUDE_FINALIZED) {
    console.log(`\n  ${protectedSlips.length} slip(s) are FINALIZED or PAID and will be KEPT:`);
    for (const s of protectedSlips.slice(0, 10)) {
      console.log(`     ${`${s.employee.firstName} ${s.employee.lastName}`.slice(0, 24).padEnd(26)}`
        + ` ${s.status.padEnd(10)} net ${inr(s.netPay)}`);
    }
    if (protectedSlips.length > 10) console.log(`     ...and ${protectedSlips.length - 10} more`);
    console.log('  (pass --include-finalized to delete those too)');
  }

  const items = target.reduce((t, s) => t + s._count.items, 0);
  const encash = target.reduce((t, s) => t + s._count.encashments, 0);
  const lop = target.reduce((t, s) => t + (s.lossOfPay || 0), 0);

  console.log(`\n  to delete       : ${target.length} payslip(s)`);
  console.log(`  payslip items   : ${items}  (deleted with them)`);
  console.log(`  leave payouts   : ${encash}  (kept, link cleared)`);
  console.log(`  net on them     : ${inr(target.reduce((t, s) => t + (s.netPay || 0), 0))}`);
  console.log(`  loss of pay     : ${inr(lop)}   <- the figure that made them wrong`);

  if (!APPLY) { console.log('\nRe-run with --apply to delete.'); return; }
  if (!target.length) { console.log('\nNothing matched.'); return; }

  if (INCLUDE_FINALIZED && protectedSlips.length) {
    const a = await ask(`\nThis deletes ${protectedSlips.length} FINALIZED/PAID slip(s). Type "yes" to continue: `);
    if (a !== 'yes') { console.log('Cancelled.'); return; }
  }

  const { count } = await prisma.payslip.deleteMany({ where: { id: { in: target.map((s) => s.id) } } });
  console.log(`\nDeleted ${count} payslip(s) for ${MONTH}/${YEAR}.`);
  console.log('Attendance and salary structures are unchanged — regenerating rebuilds these.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
