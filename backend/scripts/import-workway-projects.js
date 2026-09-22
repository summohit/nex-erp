/**
 * Reconciles Workway projects into NEX.
 *
 * The bulk migration already happened on 2026-08-20; 80 of Workway's 82
 * projects are present. This fills the two gaps that left:
 *
 *   1. Projects created in Workway since that import (2 at time of writing).
 *   2. budgetAmount, which the original import did not carry across at all --
 *      1 of 89 NEX projects has one, against 56 available in Workway.
 *
 * Reads scraper/out_projects/projects-raw.json. Matching is by project code
 * (NEX `key`, unique per company) and falls back to a normalised name, which is
 * how the 18 code-less Workway projects were matched.
 *
 *   node scripts/import-workway-projects.js --dry-run
 *   node scripts/import-workway-projects.js --budgets      # backfill only
 *   node scripts/import-workway-projects.js                # create + backfill
 *
 * Existing projects are never renamed, re-dated or re-statused: they have been
 * edited in NEX for a month and Workway is no longer the authority on them.
 * Only budgetAmount is written, and only where NEX has none.
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

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const BUDGETS_ONLY = args.includes('--budgets');
const COMPANY_ID = Number(args[args.indexOf('--company') + 1]) || 1;

const RAW = path.join(__dirname, '..', '..', 'scraper', 'out_projects', 'projects-raw.json');

/** Workway renders most cells as HTML; the value is the text inside. */
const strip = (v) => typeof v === 'string'
  ? v.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#039;/g, "'")
     .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
     .replace(/\s+/g, ' ').trim()
  : '';

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Entity-decode a plain (non-HTML) Workway field. `project` arrives as
 *  "Hero Motocorb Fortinet Firewall &amp; Switch" -- storing that verbatim
 *  puts the raw entity on screen. */
const decode = (v) => String(v ?? '')
  .replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** Workway writes dates as DD-MM-YYYY. */
function toDate(s) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(strip(s) || String(s || ''));
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z`) : null;
}

// Workway's vocabulary -> the workStatus values already in use in this company.
const STATUS = {
  'in progress': 'ACTIVE',
  'not started': 'DRAFT',
  'finished': 'COMPLETED',
  'on hold': 'ON_HOLD',
};

function projectOf(row) {
  const code = strip(row.project_short_code);
  const name = decode(row.project) || strip(row.project_name);
  const pct = parseInt(String(row.completion_export || '').replace(/\D/g, ''), 10);
  return {
    workwayId: row.id,
    code,
    name,
    startDate: toDate(row.start_date),
    endDate: toDate(row.deadline),
    budget: Number(row.project_budget) || null,
    category: strip(row.project_cat) || null,
    // A project with no status but 100% complete is finished, not active --
    // three of the 82 carry an empty status and would otherwise land as ACTIVE.
    workStatus: STATUS[String(row.project_status || '').toLowerCase()]
      || (pct === 100 ? 'COMPLETED' : 'ACTIVE'),
    progress: Number.isFinite(pct) ? pct : null,
    memberNames: String(row.name || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/** A short key for a project Workway never gave a code, in NEX's own format. */
async function makeKey(name, taken) {
  const now = new Date();
  const base = `CES/${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(-2)}/`;
  let max = 0;
  for (const k of taken) {
    if (!k.startsWith(base)) continue;
    const n = parseInt(k.split('/')[2], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  let seq = max + 1, key;
  do { key = `${base}${String(seq++).padStart(2, '0')}`; } while (taken.has(key));
  return key;
}

async function main() {
  const rows = JSON.parse(fs.readFileSync(RAW, 'utf8')).data.map(projectOf);
  console.log(`Workway projects in export: ${rows.length}${DRY ? '   — DRY RUN' : ''}\n`);

  const nex = await prisma.project.findMany({
    where: { companyId: COMPANY_ID, isSystem: false },
    select: { id: true, key: true, name: true, budgetAmount: true },
  });
  const byKey = new Map(nex.map((p) => [p.key, p]));
  const byName = new Map(nex.map((p) => [norm(p.name), p]));
  const taken = new Set(nex.map((p) => p.key));

  const employees = await prisma.employee.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, firstName: true, lastName: true },
  });
  const empByName = new Map(
    employees.map((e) => [norm(`${e.firstName} ${e.lastName}`), e.id]),
  );

  const missing = [], budgetFixes = [];
  for (const r of rows) {
    const hit = (r.code && byKey.get(r.code)) || byName.get(norm(r.name));
    if (!hit) { missing.push(r); continue; }
    if (r.budget && hit.budgetAmount == null) budgetFixes.push({ nex: hit, wanted: r.budget });
  }

  // ---- 1. Projects Workway has and NEX does not -------------------------
  console.log(`Missing from NEX: ${missing.length}`);
  for (const r of missing) {
    const key = r.code || await makeKey(r.name, taken);
    taken.add(key);
    const members = r.memberNames.map((n) => ({ name: n, id: empByName.get(norm(n)) ?? null }));
    const unknown = members.filter((m) => !m.id).map((m) => m.name);

    console.log(`\n  ${key}  ${r.name}`);
    console.log(`     ${r.workStatus} · ${r.category || 'no category'} · budget ${r.budget ?? '—'} · ${r.progress ?? 0}%`);
    console.log(`     members: ${members.filter((m) => m.id).length}/${members.length} matched${unknown.length ? ` (unmatched: ${unknown.join(', ')})` : ''}`);

    if (DRY || BUDGETS_ONLY) { console.log('     WOULD CREATE'); continue; }

    const created = await prisma.project.create({
      data: {
        companyId: COMPANY_ID, name: r.name, key,
        startDate: r.startDate, endDate: r.endDate,
        budgetAmount: r.budget, currency: 'INR',
        category: r.category, workStatus: r.workStatus, progress: r.progress,
        // Same default board every project created through the UI gets --
        // without it the board view has nowhere to put a task.
        boards: {
          create: {
            name: 'Main Board',
            columns: {
              create: [
                { name: 'To Do', color: '#6b7280', position: 0, isSystem: true, type: 'TODO' },
                { name: 'In Progress', color: '#3b82f6', position: 1, isSystem: true, type: 'IN_PROGRESS' },
                { name: 'In Review', color: '#8b5cf6', position: 2, isSystem: true, type: 'REVIEW' },
                { name: 'Done', color: '#22c55e', position: 3, isSystem: true, type: 'DONE' },
                { name: 'Archived', color: '#9ca3af', position: 4, isSystem: true, type: 'DONE' },
              ],
            },
          },
        },
        members: {
          create: members.filter((m) => m.id).map((m) => ({ employeeId: m.id, role: 'MEMBER' })),
        },
      },
    });
    console.log(`     created (id ${created.id})`);
  }

  // ---- 2. budgetAmount the original import never carried ----------------
  console.log(`\nBudgets to backfill: ${budgetFixes.length}`);
  let done = 0;
  for (const f of budgetFixes) {
    if (DRY) { done++; continue; }
    await prisma.project.update({ where: { id: f.nex.id }, data: { budgetAmount: f.wanted } });
    done++;
  }
  const sum = budgetFixes.reduce((a, f) => a + f.wanted, 0);
  console.log(`  ${DRY ? 'would set' : 'set'} ${done} budgets, total ₹${sum.toLocaleString('en-IN')}`);
  if (budgetFixes.length) {
    console.log('  sample:');
    for (const f of budgetFixes.slice(0, 5)) {
      console.log(`    ${f.nex.key.padEnd(18)} ${f.nex.name.slice(0, 40).padEnd(42)} ₹${f.wanted.toLocaleString('en-IN')}`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
