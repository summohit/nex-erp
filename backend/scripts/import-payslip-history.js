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
 *
 * LINE ITEMS, AND WHY lossOfPay STAYS ZERO
 *
 * The first version of this read the rendered table, which showed four totals,
 * so a payslip imported into NEX had correct figures and nothing to explain
 * them: "Present Days 0, Absent Days 26" and a single Total Earnings line.
 * /api/payslips carries the whole slip, so each component now lands as a
 * PayslipItem and the detail view reads like the original.
 *
 * "Unpaid Days Deduction" is the proration for days not worked — NEX's
 * lossOfPay by another name, and it goes in that field.
 *
 * The first version kept it as a DEDUCTION line and left lossOfPay at zero, on
 * the reasoning that the source already counts it inside totalDeductions and
 * the detail view adds the two together. That avoided double-counting but paid
 * for it elsewhere: the employee's payslip card reads lossOfPay, so everybody
 * saw "LOP Penalty: ₹0" beside a payslip that had deducted ₹9,677 for unpaid
 * days. NEX has a field for this concept and screens built on it.
 *
 * So the amount is lifted OUT of totalDeductions and into lossOfPay, and does
 * not appear as a line. Total Deductions on screen is totalDeductions +
 * lossOfPay, which comes back to the source's own figure; the card reads the
 * field and is right; and the detail view has a Loss of Pay row of its own.
 *
 * Days: the source records noOfDays (days paid) and nothing else, so that is
 * written to workingDays and presentDays, and absentDays is left at zero. The
 * days not worked are in the unpaid-days line, not in a count the source kept.
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
    let items = (s.items || []).filter((i) => Number(i.amount) > 0);
    let excluded = [];

    // Pulled out of the lines and into its own field — see the note above.
    const UNPAID = /^unpaid days deduction$/i;
    const lossOfPay = items
      .filter((i) => i.type === 'DEDUCTION' && UNPAID.test(i.name))
      .reduce((t, i) => t + Number(i.amount), 0);
    items = items.filter((i) => !(i.type === 'DEDUCTION' && UNPAID.test(i.name)));

    /*
     * Some deduction lines are shown on the source payslip but are not in its
     * totalDeductions and do not reduce its netPay: an Advance Salary of
     * ₹10,000 on one July slip, an "Other Deduction" of ₹3,200 on another.
     * In both, net came to gross minus the OTHER deductions exactly.
     *
     * Importing them would put a breakdown in NEX that contradicts the total
     * printed beside it. So a line is dropped when doing so is what makes the
     * arithmetic close, and it is named in the output — because a deduction
     * that appears on somebody's payslip and does not reduce their pay is
     * worth somebody looking at, in the system that produced it.
     */
    const sumOf = (list, type) =>
      list.filter((i) => i.type === type).reduce((t, i) => t + Number(i.amount), 0);

    const deductionsExLop = Math.round((deductions - lossOfPay) * 100) / 100;

    if (Math.abs(sumOf(items, 'DEDUCTION') - deductionsExLop) > 1) {
      const UNCOUNTED = /^(advance salary|other deduction)$/i;
      const kept = items.filter((i) => !(i.type === 'DEDUCTION' && UNCOUNTED.test(i.name)));
      if (Math.abs(sumOf(kept, 'DEDUCTION') - deductionsExLop) <= 1) {
        excluded = items.filter((i) => i.type === 'DEDUCTION' && UNCOUNTED.test(i.name));
        items = kept;
      }
    }
    // Items that do not add up to the totals mean the export missed a
    // component. Better to say so than to show a breakdown that disagrees
    // with the figure beside it.
    const itemEarn = items.filter((i) => i.type === 'EARNING').reduce((t, i) => t + Number(i.amount), 0);
    const itemDed = items.filter((i) => i.type === 'DEDUCTION').reduce((t, i) => t + Number(i.amount), 0);
    const itemsOff = Math.abs(itemEarn - gross) > 1 || Math.abs(itemDed - deductionsExLop) > 1;

    plan.push({
      action: existing ? 'REPLACE' : 'CREATE',
      who: `${emp.firstName} ${emp.lastName}`, code,
      employeeId: emp.id, companyId: emp.companyId,
      gross, deductions, net, slipNo: s.slip_no, status: s.status,
      items, excluded, lossOfPay, deductionsExLop, days: Number(s.no_of_days) || 0,
      existingStatus: existing?.status, existingNet: existing?.netPay,
      detail: [
        mismatch ? `net ${inr(net)} != gross-deductions ${inr(implied)}` : '',
        itemsOff ? `items sum to ${inr(itemEarn)}/${inr(itemDed)} not ${inr(gross)}/${inr(deductions)}` : '',
        !items.length ? 'no line items' : '',
        excluded.length
          ? `excluded ${excluded.map((e) => `${e.name} ${inr(e.amount)}`).join(', ')} — shown on the payslip but not deducted from it`
          : '',
      ].filter(Boolean).join('; '),
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
  console.log(`  line items: ${writable.reduce((t, p) => t + p.items.length, 0)}`);
  const withLop = writable.filter((p) => p.lossOfPay > 0);
  console.log(`  loss of pay : ${inr(withLop.reduce((t, p) => t + p.lossOfPay, 0))} across ${withLop.length} payslip(s)`);
  const withExcluded = writable.filter((p) => p.excluded.length);
  if (withExcluded.length) {
    console.log(`\n  LINES ON THE PAYSLIP THAT DO NOT REDUCE ITS NET PAY (not imported):`);
    for (const p of withExcluded) {
      for (const e of p.excluded) console.log(`     ${p.who.padEnd(26)} ${e.name.padEnd(22)} ${inr(e.amount)}`);
    }
  }
  const noItems = writable.filter((p) => !p.items.length);
  if (noItems.length) console.log(`  WITHOUT a breakdown: ${noItems.length}  (${noItems.map((p) => p.who).join(', ')})`);

  if (finalised.length) {
    console.log(`\n  WARNING: ${finalised.length} of these would overwrite a payslip already`
      + ` FINALIZED or PAID in NEX. Those are records somebody may have been shown.`);
  }

  if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

  for (const p of writable) {
    const figures = {
      totalEarnings: p.gross,
      // Excludes the unpaid-days amount, which rides in lossOfPay. The screens
      // add the two back together.
      totalDeductions: p.deductionsExLop,
      netPay: p.net,
      lossOfPay: p.lossOfPay,
      status: 'PAID',
      // Days paid. The old rows carried "present 0 of 26" left over from a
      // generation that ran before anybody had a salary, which read as though
      // the person had not turned up all month.
      ...(p.days ? { workingDays: p.days, presentDays: p.days, absentDays: 0 } : {}),
    };
    const slip = await prisma.payslip.upsert({
      where: { employeeId_month_year: { employeeId: p.employeeId, month: period.month, year: period.year } },
      update: figures,
      create: {
        employeeId: p.employeeId, companyId: p.companyId,
        month: period.month, year: period.year, ...figures,
      },
    });

    // Replaced wholesale: a leftover line from an earlier generation would sit
    // alongside the imported ones and silently change what the slip says.
    await prisma.payslipItem.deleteMany({ where: { payslipId: slip.id } });
    if (p.items.length) {
      await prisma.payslipItem.createMany({
        data: p.items.map((i) => ({
          payslipId: slip.id,
          componentName: i.name,
          type: i.type,
          amount: Number(i.amount),
        })),
      });
    }
    console.log(`  ${p.who}: ${inr(p.net)}  (${p.items.length} line${p.items.length === 1 ? '' : 's'})`);
  }
  console.log(`\nDone. ${writable.length} payslip(s) recorded for ${PERIOD}.`);
  console.log('Salary structures were not touched.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
