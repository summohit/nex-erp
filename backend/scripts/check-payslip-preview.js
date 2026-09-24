/**
 * Predict what a payslip would contain, without generating one.
 *
 * The imported components are only half of a payslip. payroll.service.ts adds
 * statutory deductions of its own and suppresses each one ONLY when a
 * component name already contains the phrase it looks for -- "Provident Fund",
 * "State Insurance", "Professional Tax", "TDS". The whole reason Workway's EPF
 * and ESI were renamed on import was to hit those phrases, and whether that
 * worked cannot be read off the structures alone.
 *
 * So this replays the engine's rules against what was actually imported and
 * says what each person's slip would show. Read-only: no Payslip row is
 * created, which matters because generating one for real would leave DRAFT
 * slips behind for a month nobody has run yet.
 *
 *   node scripts/check-payslip-preview.js              # everyone, summary
 *   node scripts/check-payslip-preview.js afnan        # one person, in full
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const FILTER = process.argv[2];

(async () => {
  const emps = await prisma.employee.findMany({
    where: { salaryStructures: { some: {} } },
    select: {
      id: true, firstName: true, lastName: true,
      salaryStructures: { select: { amount: true, component: { select: { name: true, type: true } } } },
    },
  });

  let doubles = 0;
  const rows = [];

  for (const e of emps) {
    const name = `${e.firstName} ${e.lastName}`.trim();
    if (FILTER && !name.toLowerCase().includes(FILTER.toLowerCase())) continue;

    const items = [];
    let earnings = 0, deductions = 0, basic = 0;
    for (const s of e.salaryStructures) {
      const amt = s.amount || 0;
      if (amt <= 0) continue;
      items.push({ name: s.component.name, type: s.component.type, amount: amt, from: 'imported' });
      if (s.component.type === 'EARNING') {
        earnings += amt;
        if (s.component.name.toLowerCase().includes('basic')) basic = amt;
      } else deductions += amt;
    }
    if (basic === 0 && earnings > 0) basic = earnings * 0.5;

    // The same four rules, in the same order, as the statutory block.
    const add = (label, phrase, amount) => {
      if (amount <= 0) return;
      if (items.some((i) => i.name.includes(phrase))) return;   // already covered
      items.push({ name: label, type: 'DEDUCTION', amount, from: 'statutory' });
      deductions += amount;
    };
    add('Provident Fund (PF) [Statutory]', 'Provident Fund', Math.round(basic * 0.12));
    if (earnings > 0 && earnings <= 21000) add('Employee State Insurance (ESI) [Statutory]', 'State Insurance', Math.round(earnings * 0.0075));
    if (earnings > 15000) add('Professional Tax [Statutory]', 'Professional Tax', 200);
    if (earnings > 50000) add('Income Tax (TDS) [Statutory]', 'TDS', Math.round((earnings - 50000) * 0.10));

    // What this is really checking: the same deduction arriving twice.
    const count = (phrase) => items.filter((i) => i.name.includes(phrase)).length;
    const dup = ['Provident Fund', 'State Insurance', 'TDS'].filter((p) => count(p) > 1);
    if (dup.length) doubles++;

    rows.push({ name, earnings, deductions, net: earnings - deductions, items, dup });
  }

  rows.sort((a, b) => b.earnings - a.earnings);

  for (const r of rows) {
    console.log(`\n${r.name}   earnings ${r.earnings.toFixed(2)}   deductions ${r.deductions.toFixed(2)}`
      + `   net ${r.net.toFixed(2)}${r.dup.length ? `   *** DOUBLE: ${r.dup.join(', ')} ***` : ''}`);
    if (FILTER) {
      for (const i of r.items) {
        console.log(`    ${i.type === 'EARNING' ? '+' : '-'} ${i.name.padEnd(40)} `
          + `${i.amount.toFixed(2).padStart(11)}  ${i.from}`);
      }
    }
  }

  const newPT = rows.filter((r) => r.items.some((i) => i.from === 'statutory' && i.name.includes('Professional Tax')));
  const newPF = rows.filter((r) => r.items.some((i) => i.from === 'statutory' && i.name.includes('Provident Fund')));
  console.log(`\n${rows.length} employee(s) previewed`);
  console.log(`  double deductions          : ${doubles}`);
  console.log(`  gain Professional Tax ₹200 : ${newPT.length}   (new; Workway had no equivalent)`);
  console.log(`  gain a statutory PF line   : ${newPF.length}   (had no PF in Workway)`);
  console.log('\nRead-only — no payslip was created.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
