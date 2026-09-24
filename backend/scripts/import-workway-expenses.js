/**
 * Import Workway expenses into NEX as ExpenseClaim rows.
 *
 *   node scripts/import-workway-expenses.js            # dry run
 *   node scripts/import-workway-expenses.js --apply
 *
 * Input: scraper/out_finance/workway-expenses.json (scraper/workway_expenses.py).
 *
 * TWO KINDS OF ROW IN ONE TABLE
 *
 * 607 of the 795 belong to a person — travel, meals, things they bought and
 * want back. The other 188, ₹84.7 lakh of them, are the company's own costs:
 * rent for units 901-902, electricity, recurring building charges. Nobody
 * claimed those, so they import with no employee, which is why employeeId was
 * made optional. Recording the office rent as somebody's personal claim would
 * have made every reimbursement report wrong.
 *
 * MATCHING PEOPLE
 *
 * Workway gives one string: "Mr Ajay Sagar Network Engineer" — salutation,
 * name and designation run together, 47 distinct values and no email or code.
 * Name alone is not safe here: this company has two Rajesh Kumars and two
 * Pritish Agnihotris, and a payslip import earlier today found employee codes
 * pointing at different people in different systems. So a row is matched on
 * name AND designation, and anything ambiguous is refused rather than guessed.
 *
 * CATEGORIES
 *
 * NEX's category is free text with five conventional values, not a database
 * enum, so Workway's own categories are carried across as they are and become
 * new categories. Rows with no category — chiefly the company costs — land in
 * MISCELLANEOUS rather than being forced into one of the five.
 *
 * RUNNING IT TWICE
 *
 * ExpenseClaim has no Workway id to key on, so a re-run would otherwise double
 * every row. An existing claim is recognised by company, title, amount and
 * purchase date together, and updated rather than added.
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
const SRC = path.join(__dirname, '..', '..', 'scraper', 'out_finance', 'workway-expenses.json');

const SALUTATION = /^(mr|mrs|miss|ms|dr)\s+/i;

/**
 * Undo HTML escaping.
 *
 * The values come out of a DataTables payload that is HTML, so an ampersand
 * arrives as "&amp;" — the first dry run listed a category called
 * "Tour &amp; Travels" and would have created it under that name. Done here
 * rather than in the scraper so the raw export stays a faithful copy of what
 * the endpoint returned.
 */
const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};
const decode = (v) =>
  String(v ?? '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** "21-09-2026" -> Date, or null. */
const parseDate = (s) => {
  const m = String(s || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : d;
};

const STATUS = { approved: 'APPROVED', pending: 'PENDING', rejected: 'REJECTED' };

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error(`no export at ${SRC} — run scraper/workway_expenses.py first`);
    process.exit(1);
  }
  const rows = JSON.parse(fs.readFileSync(SRC, 'utf8')).rows || [];
  if (!rows.length) { console.error('the export is empty'); process.exit(1); }

  const employees = await prisma.employee.findMany({
    select: {
      id: true, firstName: true, lastName: true, companyId: true,
      designation: { select: { name: true } },
    },
  });

  // The company these costs belong to: whichever one most employees are in.
  // Company expenses have no employee to read it from.
  const tally = {};
  for (const e of employees) tally[e.companyId] = (tally[e.companyId] || 0) + 1;
  const COMPANY_ID = Number(Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0]);
  if (!COMPANY_ID) { console.error('could not determine a company'); process.exit(1); }

  /**
   * Resolve "Mr Ajay Sagar Network Engineer".
   *
   * The string is a concatenation with no separator, so it is matched by
   * asking which employees' names it STARTS with once the salutation is gone.
   * Where more than one matches, the designation decides; where it still does
   * not, the row is refused.
   */
  const resolve = (raw) => {
    const s = String(raw || '').replace(SALUTATION, '').trim();
    if (!s) return { kind: 'none' };
    const flat = norm(s);

    const candidates = employees.filter((e) => {
      const full = norm(`${e.firstName}${e.lastName || ''}`);
      return full.length >= 4 && flat.startsWith(full);
    });
    if (!candidates.length) return { kind: 'unmatched', text: s };
    if (candidates.length === 1) return { kind: 'ok', employee: candidates[0] };

    const byDesignation = candidates.filter(
      (e) => e.designation?.name && flat.includes(norm(e.designation.name)));
    if (byDesignation.length === 1) return { kind: 'ok', employee: byDesignation[0] };

    return {
      kind: 'ambiguous', text: s,
      who: candidates.map((e) => `${e.firstName} ${e.lastName} (${e.designation?.name || 'no designation'})`),
    };
  };

  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}`);
  console.log(`${rows.length} expense(s) from Workway · company ${COMPANY_ID}\n`);

  const plan = [];
  const resolutions = new Map();

  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    const title = decode(r.item_name) || '(untitled)';
    const purchaseDate = parseDate(r.purchase_date);
    const status = STATUS[String(r.status || '').toLowerCase()] || 'PENDING';

    let employeeId = null;
    let note = '';
    const who = decode(r.employee);
    if (who) {
      if (!resolutions.has(who)) resolutions.set(who, resolve(who));
      const res = resolutions.get(who);
      if (res.kind === 'ok') employeeId = res.employee.id;
      else if (res.kind === 'ambiguous') note = `AMBIGUOUS: ${res.who.join(' / ')}`;
      else note = 'no NEX employee matches';
    }

    // A company cost, or a claim whose owner could not be resolved. Both go in
    // without an employee; only the second is a problem, and it is named.
    const category = decode(r.category) || (who ? 'OTHER' : 'MISCELLANEOUS');

    plan.push({
      workwayId: r.id,
      title, amount, purchaseDate, status, employeeId, category, note,
      isCompanyCost: !who,
      unresolved: !!who && !employeeId,
      purchasedFrom: decode(r.purchased_from) || null,
      description: decode(r.description) || null,
      receiptUrl: String(r.attachment_url || r.bill_url || '').trim() || null,
      projectName: decode(r.project) || null,
    });
  }

  // Already imported? No Workway id is stored, so the natural key is what a
  // human would use to say "that is the same expense".
  const existing = await prisma.expenseClaim.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, title: true, amount: true, purchaseDate: true },
  });
  const keyOf = (t, a, d) =>
    `${norm(t)}|${Math.round(Number(a) * 100)}|${d ? new Date(d).toISOString().slice(0, 10) : ''}`;
  const seen = new Map(existing.map((e) => [keyOf(e.title, e.amount, e.purchaseDate), e.id]));

  for (const p of plan) {
    p.existingId = seen.get(keyOf(p.title, p.amount, p.purchaseDate)) ?? null;
    p.action = p.existingId ? 'UPDATE' : 'CREATE';
  }

  const unresolved = plan.filter((p) => p.unresolved);
  const companyCosts = plan.filter((p) => p.isCompanyCost);
  const byCategory = {};
  for (const p of plan) byCategory[p.category] = (byCategory[p.category] || 0) + 1;
  const byStatus = {};
  for (const p of plan) byStatus[p.status] = (byStatus[p.status] || 0) + 1;

  console.log(`  create             : ${plan.filter((p) => p.action === 'CREATE').length}`);
  console.log(`  update (re-run)    : ${plan.filter((p) => p.action === 'UPDATE').length}`);
  console.log(`  with an employee   : ${plan.filter((p) => p.employeeId).length}`);
  console.log(`  company costs      : ${companyCosts.length}  (no employee, ${inr(companyCosts.reduce((t, p) => t + p.amount, 0))})`);
  console.log(`  UNRESOLVED people  : ${unresolved.length}  (named below; imported without an employee)`);
  console.log(`  total value        : ${inr(plan.reduce((t, p) => t + p.amount, 0))}`);
  console.log(`  no purchase date   : ${plan.filter((p) => !p.purchaseDate).length}`);

  console.log('\n  status:');
  for (const [k, v] of Object.entries(byStatus).sort()) console.log(`     ${k.padEnd(10)} ${v}`);

  console.log('\n  categories (Workway\'s own, created as they land):');
  for (const [k, v] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${String(k).slice(0, 34).padEnd(36)} ${v}`);
  }

  if (unresolved.length) {
    const names = new Map();
    for (const p of unresolved) names.set(p.note, (names.get(p.note) || 0) + 1);
    console.log('\n  PEOPLE THAT COULD NOT BE RESOLVED:');
    for (const [k, v] of names) console.log(`     ${v} row(s): ${k}`);
    for (const [text, res] of resolutions) {
      if (res.kind !== 'ok') console.log(`     "${text}" -> ${res.kind}`);
    }
  }

  if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

  let created = 0;
  let updated = 0;
  for (const p of plan) {
    const data = {
      title: p.title,
      description: p.description,
      amount: p.amount,
      category: p.category,
      status: p.status,
      purchaseDate: p.purchaseDate,
      purchasedFrom: p.purchasedFrom,
      projectName: p.projectName,
      receiptUrl: p.receiptUrl,
      month: p.purchaseDate ? p.purchaseDate.getUTCMonth() + 1 : null,
      year: p.purchaseDate ? p.purchaseDate.getUTCFullYear() : null,
    };
    if (p.existingId) {
      await prisma.expenseClaim.update({ where: { id: p.existingId }, data });
      updated++;
    } else {
      await prisma.expenseClaim.create({
        data: { ...data, companyId: COMPANY_ID, employeeId: p.employeeId },
      });
      created++;
    }
    if ((created + updated) % 100 === 0) console.log(`  ${created + updated}/${plan.length}`);
  }

  console.log(`\nDone. ${created} created, ${updated} updated.`);
  if (unresolved.length) {
    console.log(`${unresolved.length} row(s) went in without an employee because the name could not be resolved — see above.`);
  }
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
