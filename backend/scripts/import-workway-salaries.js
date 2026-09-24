/**
 * Import Workway salaries into NEX as SalaryStructure rows.
 *
 *   node scripts/import-workway-salaries.js            # dry run
 *   node scripts/import-workway-salaries.js --apply
 *
 * Input: scraper/out_finance/salaries.json (see scraper/workway_salary.py).
 *
 * WHAT WORKWAY HAS AND NEX DOES NOT
 *
 * Workway stores a calculation ("Basic = 50 % of CTC") and derives the amount.
 * NEX's SalaryStructure stores the amount alone, so what lands here is the
 * resolved monthly figure. A later change to someone's CTC will not ripple
 * through the way it did in Workway -- the components have to be rewritten.
 *
 * THE DOUBLE-DEDUCTION, AND WHY NAMES ARE REWRITTEN
 *
 * payroll.service.ts adds statutory deductions itself, and skips its own only
 * when a component name already contains the phrase it looks for:
 *
 *     PF   <- "Provident Fund"      ESI <- "State Insurance"
 *     PT   <- "Professional Tax"    TDS <- "TDS"
 *
 * Workway calls them EPF and ESI, neither of which matches, so importing those
 * names verbatim would have every one of the twenty people who has them
 * deducted PF and ESI TWICE -- once from this import, once from the engine.
 * Renaming to the phrases the engine recognises keeps Workway's real amounts
 * and switches its calculation off. "TDS 2% (Technical Consultant)" already
 * contains TDS and is left alone.
 *
 * Professional Tax has no Workway equivalent, so NEX will start deducting ₹200
 * from everyone over ₹15,000. That is new, and it is the engine's rule rather
 * than anything this import does.
 *
 * THREE DECISIONS THAT WERE MADE BY A HUMAN, NOT BY THIS SCRIPT
 *
 *   1. EPF/ESI are renamed (above) rather than dropped.
 *   2. A stale component sheet is imported AS IT STANDS. Five people have had
 *      raises that updated Workway's list and history but never their sheet;
 *      three of those have a sheet at all, and they import at the pre-raise
 *      figure. Every one is named in the output.
 *   3. Someone with no sheet gets a single Basic Salary holding their whole
 *      monthly pay -- which means PF of 12% applies to all of it rather than
 *      to a basic that is half of it.
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
const SRC = path.join(__dirname, '..', '..', 'scraper', 'out_finance', 'salaries.json');

/** Workway's name -> the name NEX's statutory engine recognises. */
const RENAME = {
  'EPF': 'Provident Fund (PF)',
  'ESI': 'Employee State Insurance (ESI)',
};

/**
 * Components that exist in Workway but must not become NEX deductions.
 *
 * "Other Deduction" is a flat ₹1,800 for all twenty people who have it -- the
 * same figure as their EPF line, which is the giveaway: it is the EMPLOYER's
 * PF contribution. That belongs to cost-to-company, not to anything taken off
 * a payslip, and importing it as a deduction would quietly cost each of those
 * twenty ₹1,800 a month of take-home. Confirmed with the people who run the
 * payroll rather than inferred from the number alone.
 */
const SKIP = new Set(['Other Deduction']);

/** "Special Allowance (Annual CTC - Sum of...)" is one component, not many. */
const normalise = (s) => {
  const base = String(s || '').split(' (Annual CTC')[0].trim();
  return RENAME[base] || base;
};

const money = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[₹,+\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error(`no scrape at ${SRC} — run scraper/workway_salary.py first`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const sheetBy = new Map(data.sheets.map((s) => [String(s.salary_id), s]));
  const histBy = new Map(data.history.map((h) => [String(h.user_id), h]));

  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);

  const plan = [];
  const problems = [];

  for (const row of data.list) {
    const email = String(row.email || '').trim();
    const uid = String(row.salary_id || row.id || '');
    if (!email) continue;

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        employee: {
          select: {
            id: true, firstName: true, lastName: true, companyId: true,
            salaryStructures: { select: { id: true, componentId: true, amount: true } },
          },
        },
      },
    });
    const emp = user?.employee;

    const entries = (histBy.get(uid)?.entries) || [];
    const current = entries.reduce((t, e) => t + money(e.amount_monthly), 0);
    const initials = entries.filter((e) => e.value_type === 'initial');
    const sheet = sheetBy.get(uid);
    const hasSheet = !!(sheet && sheet.annual_ctc);

    if (!emp) {
      if (current > 0) problems.push(`${email}: has pay in Workway but no NEX employee`);
      plan.push({ email, action: 'NO MATCH', current });
      continue;
    }
    if (!current && !hasSheet) {
      plan.push({ email, name: `${emp.firstName} ${emp.lastName}`, action: 'NO SALARY', current: 0 });
      continue;
    }

    // Components: the sheet when there is one, otherwise the whole figure as Basic.
    let items = [];
    let source;
    let skipped = 0;   // employer-side lines left out of the payslip
    if (hasSheet) {
      source = 'sheet';
      for (const kind of ['earnings', 'deductions']) {
        for (const c of sheet[kind] || []) {
          const amt = money(c.monthly);
          if (!amt) continue;
          const name = normalise(c.component);
          if (SKIP.has(name)) { skipped += amt; continue; }
          items.push({ name, type: kind === 'earnings' ? 'EARNING' : 'DEDUCTION', amount: amt });
        }
      }
    } else {
      source = 'history only';
      items = [{ name: 'Basic Salary', type: 'EARNING', amount: current }];
    }

    const earn = items.filter((i) => i.type === 'EARNING').reduce((t, i) => t + i.amount, 0);
    const ded = items.filter((i) => i.type === 'DEDUCTION').reduce((t, i) => t + i.amount, 0);

    // The sheet is stale when its earnings do not reach the figure history says
    // is in force. Imported as-is by instruction; named here so it is not a
    // surprise on somebody's payslip.
    const stale = hasSheet && current > 0 && Math.abs(earn - current) >= 1;
    if (stale) problems.push(
      `${email}: sheet pays ${earn.toFixed(2)}/month but history says ${current.toFixed(2)} `
      + `(short by ${(current - earn).toFixed(2)}) — imported as-is`);
    if (initials.length > 1) problems.push(
      `${email}: ${initials.length} "initial" history rows (a duplicate, not a raise) — `
      + `sheet figure ${earn.toFixed(2)} used, the summed ${current.toFixed(2)} was NOT`);

    plan.push({
      email, name: `${emp.firstName} ${emp.lastName}`, employeeId: emp.id,
      companyId: emp.companyId, action: emp.salaryStructures.length ? 'REPLACE' : 'CREATE',
      existing: emp.salaryStructures.length, source, items, earn, ded, current, stale, skipped,
    });
  }

  for (const p of plan) {
    if (p.action === 'NO MATCH' || p.action === 'NO SALARY') {
      console.log(`  ${p.action.padEnd(9)} ${String(p.name || p.email).slice(0, 26).padEnd(28)}`);
      continue;
    }
    console.log(`  ${p.action.padEnd(9)} ${p.name.slice(0, 24).padEnd(26)} ${p.source.padEnd(13)}`
      + `earn ${p.earn.toFixed(2).padStart(11)}  ded ${p.ded.toFixed(2).padStart(9)}`
      + `${p.stale ? '  STALE' : ''}${p.skipped ? `  (employer PF ${p.skipped.toFixed(2)} not deducted)` : ''}`);
    for (const i of p.items) {
      console.log(`              ${i.type === 'EARNING' ? '+' : '-'} ${i.name.padEnd(34)} ${i.amount.toFixed(2).padStart(11)}`);
    }
  }

  const writable = plan.filter((p) => p.items);
  console.log(`\n  create  : ${plan.filter((p) => p.action === 'CREATE').length}`);
  console.log(`  replace : ${plan.filter((p) => p.action === 'REPLACE').length}  (already have structures in NEX)`);
  console.log(`  no match: ${plan.filter((p) => p.action === 'NO MATCH').length}`);
  console.log(`  no pay  : ${plan.filter((p) => p.action === 'NO SALARY').length}`);
  const skipTotal = writable.reduce((t, p) => t + (p.skipped || 0), 0);
  if (skipTotal) {
    const n = writable.filter((p) => p.skipped).length;
    console.log(`  employer PF left out of deductions: ${skipTotal.toFixed(2)}/month across ${n} people`
      + `  (take-home is ${(skipTotal / n).toFixed(2)} higher each than a straight copy of Workway)`);
  }

  const names = new Map();
  for (const p of writable) for (const i of p.items) names.set(`${i.name}|${i.type}`, i);
  console.log(`\n  components to exist: ${names.size}`);
  for (const k of [...names.keys()].sort()) console.log(`     ${k.replace('|', '  ')}`);

  if (problems.length) {
    console.log(`\n  NEEDS A HUMAN (${problems.length}):`);
    for (const w of problems) console.log(`     ${w}`);
  }

  if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

  // Components are per company and shared, so they are found or made once.
  const companyIds = [...new Set(writable.map((p) => p.companyId))];
  const idOf = new Map();
  for (const companyId of companyIds) {
    for (const [key, item] of names) {
      const [name, type] = key.split('|');
      let comp = await prisma.salaryComponent.findFirst({ where: { companyId, name, type } });
      if (!comp) {
        comp = await prisma.salaryComponent.create({
          data: { companyId, name, type, description: 'Imported from Workway' },
        });
        console.log(`  + component ${name} (${type})`);
      }
      idOf.set(`${companyId}|${key}`, comp.id);
    }
  }

  for (const p of writable) {
    // Anything this person had before that Workway does not know about would
    // otherwise linger and be paid alongside the imported rows.
    const keep = new Set(p.items.map((i) => idOf.get(`${p.companyId}|${i.name}|${i.type}`)));
    const removed = await prisma.salaryStructure.deleteMany({
      where: { employeeId: p.employeeId, componentId: { notIn: [...keep] } },
    });
    for (const i of p.items) {
      const componentId = idOf.get(`${p.companyId}|${i.name}|${i.type}`);
      await prisma.salaryStructure.upsert({
        where: { employeeId_componentId: { employeeId: p.employeeId, componentId } },
        update: { amount: i.amount },
        create: { employeeId: p.employeeId, componentId, amount: i.amount },
      });
    }
    console.log(`  ${p.name}: ${p.items.length} component(s)`
      + `${removed.count ? `, ${removed.count} stale row(s) removed` : ''}`);
  }

  console.log(`\nDone. ${writable.length} employee(s) now have a salary structure.`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
