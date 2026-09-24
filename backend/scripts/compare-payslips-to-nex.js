/**
 * August's real payslips against the salary structures now in NEX.
 *
 * The structures came from Workway, which describes what somebody SHOULD be
 * paid. The payslip admin issued what they WERE paid. Where those two disagree
 * the payslip is the stronger evidence, because somebody received it.
 *
 * Three things this is looking for:
 *
 *   - people with a payslip and no salary in NEX. Workway had nothing for
 *     twelve people; if the payslip system paid them, Workway was simply
 *     missing them and NEX now is too.
 *   - figures that disagree by more than rounding. A payslip is prorated for
 *     joining dates and unpaid days, so small gaps are expected and large ones
 *     are not.
 *   - people in NEX with no payslip, which is the opposite gap.
 *
 * Read-only.
 *
 *   node scripts/compare-payslips-to-nex.js
 *   node scripts/compare-payslips-to-nex.js "July 2026"
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const PERIOD = process.argv[2] || 'August 2026';
/** Last day of the period, for deciding whether a raise post-dates the payslip. */
const PERIOD_END = (() => {
  const [name, yr] = PERIOD.split(' ');
  const m = new Date(`${name} 1, ${yr}`).getMonth();
  return new Date(Number(yr), m + 1, 0);
})();
const SRC = path.join(__dirname, '..', '..', 'scraper', 'out_finance', 'payslip-history.json');

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const inr = (n) => (n == null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 0 }));

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error(`no export at ${SRC} — run scraper/payslip_history.py first`);
    process.exit(1);
  }
  const slips = JSON.parse(fs.readFileSync(SRC, 'utf8')).rows
    .filter((r) => r.period.trim().toLowerCase() === PERIOD.toLowerCase());

  console.log(`${PERIOD}: ${slips.length} payslip(s) vs NEX salary structures\n`);

  const employees = await prisma.employee.findMany({
    include: {
      user: { select: { email: true, status: true } },
      salaryStructures: { include: { component: true } },
    },
  });
  const byEmail = new Map();
  for (const e of employees) {
    const em = (e.user?.email || '').toLowerCase();
    if (em) byEmail.set(em, e);
  }

  const nexGross = (e) =>
    (e.salaryStructures || []).reduce(
      (t, s) => t + (s.component?.type === 'EARNING' ? s.amount || 0 : 0), 0);

  const missingInNex = [];   // paid, but NEX has no structure
  const noMatch = [];        // paid, but no NEX employee at all
  const disagree = [];
  const agree = [];

  for (const s of slips) {
    const email = (s.email || '').toLowerCase();
    const emp = byEmail.get(email);
    const paidGross = num(s.gross_earnings);
    const ctcMonthly = num(s.annual_ctc) != null ? num(s.annual_ctc) / 12 : null;

    if (!emp) { noMatch.push({ ...s, paidGross }); continue; }

    const structure = nexGross(emp);
    if (structure === 0) {
      missingInNex.push({ name: s.employee, email, paidGross, ctcMonthly });
      continue;
    }

    // Compare against CTC/12 rather than the paid figure: the payslip is
    // prorated, the structure is not, so CTC is the like-for-like number.
    const ref = ctcMonthly ?? paidGross;
    const gap = ref == null ? null : structure - ref;
    const rel = ref ? Math.abs(gap) / ref : 0;
    const row = { name: s.employee, email, structure, ctcMonthly, paidGross, gap, rel };
    if (rel > 0.02) disagree.push(row); else agree.push(row);
  }

  // A raise after the payslip was issued explains a difference completely, so
  // the Workway increment dates are read before anything is called a mismatch.
  const HIST = path.join(__dirname, '..', '..', 'scraper', 'out_finance', 'salaries.json');
  const raisedAfter = new Map();
  if (fs.existsSync(HIST)) {
    const h = JSON.parse(fs.readFileSync(HIST, 'utf8'));
    const emailOf = new Map(h.list.map((r) => [String(r.salary_id), (r.email || '').toLowerCase()]));
    for (const rec of h.history || []) {
      const em = emailOf.get(String(rec.user_id)) || (rec.email || '').toLowerCase();
      for (const e of rec.entries || []) {
        // dd-mm-yyyy
        const m = String(e.date).match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (!m) continue;
        const when = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        if (when > PERIOD_END && em) {
          const prev = raisedAfter.get(em);
          if (!prev || when > prev.when) raisedAfter.set(em, { when, entry: e });
        }
      }
    }
  }

  const paidEmails = new Set(slips.map((s) => (s.email || '').toLowerCase()));
  const noPayslip = employees.filter(
    (e) => nexGross(e) > 0
      && e.user?.status !== 'SUSPENDED'
      && !paidEmails.has((e.user?.email || '').toLowerCase()));

  console.log(`  agree (within 2%)            : ${agree.length}`);
  console.log(`  disagree                     : ${disagree.length}`);
  console.log(`  paid, but no salary in NEX   : ${missingInNex.length}`);
  console.log(`  paid, but no NEX employee    : ${noMatch.length}`);
  console.log(`  salary in NEX, but no payslip: ${noPayslip.length}`);

  if (missingInNex.length) {
    console.log('\nPAID, BUT NEX HAS NO SALARY FOR THEM:');
    for (const r of missingInNex.sort((a, b) => (b.ctcMonthly ?? 0) - (a.ctcMonthly ?? 0))) {
      console.log(`  ${r.name.slice(0, 24).padEnd(26)} ${r.email.padEnd(32)}`
        + ` CTC/month ${inr(r.ctcMonthly).padStart(10)}   paid ${inr(r.paidGross).padStart(10)}`);
    }
  }

  if (disagree.length) {
    console.log('\nFIGURES THAT DISAGREE (NEX structure vs payslip CTC/12):');
    for (const r of disagree.sort((a, b) => b.rel - a.rel)) {
      const raise = raisedAfter.get(r.email);
      console.log(`  ${r.name.slice(0, 24).padEnd(26)} NEX ${inr(r.structure).padStart(10)}`
        + `   payslip ${inr(r.ctcMonthly).padStart(10)}`
        + `   diff ${((r.gap > 0 ? '+' : '') + inr(r.gap)).padStart(10)}`
        + `  (${String(Math.round(r.rel * 100)).padStart(3)}%)`
        + (raise
            ? `   <- raise ${raise.entry.date} explains a rise`
            : (r.gap > 0 ? '   <- NEX higher, no raise on record' : '   <- NEX LOWER than what was paid')));
    }
  }

  if (noMatch.length) {
    console.log('\nPAID, BUT NO NEX EMPLOYEE WITH THAT EMAIL:');
    for (const r of noMatch) {
      console.log(`  ${String(r.employee).slice(0, 24).padEnd(26)} ${String(r.email).padEnd(32)}`
        + ` paid ${inr(r.paidGross)}`);
    }
  }

  if (noPayslip.length) {
    console.log('\nSALARY IN NEX, BUT NO PAYSLIP THIS PERIOD:');
    for (const e of noPayslip) {
      console.log(`  ${`${e.firstName} ${e.lastName}`.slice(0, 24).padEnd(26)}`
        + ` ${(e.user?.email || '').padEnd(32)} NEX ${inr(nexGross(e)).padStart(10)}`);
    }
  }

  console.log('\nRead-only — nothing was changed.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
