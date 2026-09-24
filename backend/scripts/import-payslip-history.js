/**
 * Import payslips from the payslip admin into NEX as historical records.
 *
 *   node scripts/import-payslip-history.js "August 2026"
 *   node scripts/import-payslip-history.js "August 2026" --apply
 *
 * Input: scraper/out_finance/payslip-history.json (scraper/payslip_history.py).
 *
 * MATCHED ON employeeCode, NOT EMAIL
 *
 * The two systems hold different addresses for the same people: five have a work
 * address in one and a personal one in the other, for the same person.
 * Matching on email split seven of them into "paid but not
 * in NEX" and "in NEX but never paid", which is a fiction. The employee code is
 * the same in both (20241, T1127) and matches 46 of 47.
 *
 * Where a code matches but the NAMES DISAGREE the row is refused rather than
 * guessed at, because a wrong match writes one person's pay onto another's
 * record. Two rows are in that state and need a human.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not touch SalaryStructure. The payslip system disagrees with NEX's
 * structures for ten people, one of them by ₹3.37 lakh a month, and which side
 * is right is not a thing a script should decide. These are historical records
 * of what was paid; they change nothing about what will be paid.
 *
 * Status is PAID: these slips were issued and marked Sent in the source system.
 * Loss of pay is not recorded there, so it is left at zero rather than being
 * inferred from the gap between CTC and gross — that gap is mostly proration,
 * and inventing a deduction to explain it would be a guess written as a fact.
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

const APPLY = process.argv.includes('--apply');
const PERIOD = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'August 2026';
const SRC = path.join(__dirname, '..', '..', 'scraper', 'out_finance', 'payslip-history.json');

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/** "August 2026" -> { month: 8, year: 2026 } */
const parsePeriod = (p) => {
  const [name, yr] = String(p).trim().split(/\s+/);
  const m = new Date(`${name} 1, ${yr}`).getMonth();
  if (Number.isNaN(m) || !yr) return null;
  return { month: m + 1, year: Number(yr) };
};

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error(`no export at ${SRC} — run scraper/payslip_history.py first`);
    process.exit(1);
  }
  const period = parsePeriod(PERIOD);
  if (!period) { console.error(`could not read a month and year from "${PERIOD}"`); process.exit(1); }

  const slips = JSON.parse(fs.readFileSync(SRC, 'utf8')).rows
    .filter((r) => String(r.period).trim().toLowerCase() === PERIOD.toLowerCase());
  if (!slips.length) { console.error(`no payslips for "${PERIOD}" in the export`); process.exit(1); }

  const employees = await prisma.employee.findMany({
    select: {
      id: true, firstName: true, lastName: true, employeeCode: true, companyId: true,
      payslips: { where: { month: period.month, year: period.year }, select: { id: true, status: true, netPay: true } },
    },
  });
  const byCode = new Map(
    employees.filter((e) => e.employeeCode)
      .map((e) => [String(e.employeeCode).trim().toUpperCase(), e]));

  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}`);
  console.log(`${PERIOD} (month ${period.month}, year ${period.year}) · ${slips.length} payslip(s)\n`);

  const plan = [];
  for (const s of slips) {
    const code = String(s.employee_code || '').trim().toUpperCase();
    const emp = code ? byCode.get(code) : null;
    const gross = num(s.gross_earnings);
    const deductions = num(s.total_deductions);
    const net = num(s.net_salary);

    if (!emp) {
      plan.push({ action: 'NO MATCH', who: s.employee, code, detail: 'no NEX employee with this code' });
      continue;
    }

    // A code that resolves to a different name is the dangerous case: it looks
    // like a match and writes somebody else's pay onto this record.
    const a = norm(`${emp.firstName}${emp.lastName}`);
    const b = norm(s.employee);
    if (!(a.includes(b.slice(0, 5)) || b.includes(a.slice(0, 5)))) {
      plan.push({
        action: 'CONFLICT', who: s.employee, code,
        detail: `code ${code} is "${emp.firstName} ${emp.lastName}" in NEX — refusing to guess`,
      });
      continue;
    }

    // Net that does not equal gross minus deductions means the source is
    // telling us something this import does not model. Say so, do not average.
    const implied = Math.round((gross - deductions) * 100) / 100;
    const mismatch = Math.abs(implied - net) > 1;

    const existing = emp.payslips[0];
    plan.push({
      action: existing ? 'REPLACE' : 'CREATE',
      who: `${emp.firstName} ${emp.lastName}`, code,
      employeeId: emp.id, companyId: emp.companyId,
      gross, deductions, net, slipNo: s.slip_no, status: s.status,
      existingStatus: existing?.status, existingNet: existing?.netPay,
      detail: mismatch ? `net ${inr(net)} != gross-deductions ${inr(implied)}` : '',
    });
  }

  for (const p of plan) {
    if (p.action === 'NO MATCH' || p.action === 'CONFLICT') {
      console.log(`  ${p.action.padEnd(9)} ${String(p.who).slice(0, 24).padEnd(26)} ${p.detail}`);
      continue;
    }
    console.log(`  ${p.action.padEnd(9)} ${p.who.slice(0, 24).padEnd(26)} code ${String(p.code).padEnd(7)}`
      + ` gross ${inr(p.gross).padStart(10)}  ded ${inr(p.deductions).padStart(8)}  net ${inr(p.net).padStart(10)}`
      + (p.existingStatus ? `   (replacing a ${p.existingStatus} slip of ${inr(p.existingNet)})` : '')
      + (p.detail ? `   ${p.detail}` : ''));
  }

  const writable = plan.filter((p) => p.action === 'CREATE' || p.action === 'REPLACE');
  const finalised = writable.filter((p) => p.existingStatus === 'FINALIZED' || p.existingStatus === 'PAID');

  console.log(`\n  create    : ${plan.filter((p) => p.action === 'CREATE').length}`);
  console.log(`  replace   : ${plan.filter((p) => p.action === 'REPLACE').length}`);
  console.log(`  conflicts : ${plan.filter((p) => p.action === 'CONFLICT').length}   (code matches a different person)`);
  console.log(`  no match  : ${plan.filter((p) => p.action === 'NO MATCH').length}`);
  console.log(`  total net : ${inr(writable.reduce((t, p) => t + p.net, 0))}`);

  if (finalised.length) {
    console.log(`\n  WARNING: ${finalised.length} of these would overwrite a payslip already`
      + ` FINALIZED or PAID in NEX. Those are records somebody may have been shown.`);
  }

  if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

  for (const p of writable) {
    await prisma.payslip.upsert({
      where: { employeeId_month_year: { employeeId: p.employeeId, month: period.month, year: period.year } },
      update: {
        totalEarnings: p.gross, totalDeductions: p.deductions, netPay: p.net,
        lossOfPay: 0, status: 'PAID',
      },
      create: {
        employeeId: p.employeeId, companyId: p.companyId,
        month: period.month, year: period.year,
        totalEarnings: p.gross, totalDeductions: p.deductions, netPay: p.net,
        lossOfPay: 0, status: 'PAID',
      },
    });
    console.log(`  ${p.who}: ${inr(p.net)}`);
  }
  console.log(`\nDone. ${writable.length} payslip(s) recorded for ${PERIOD}.`);
  console.log('Salary structures were not touched.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
