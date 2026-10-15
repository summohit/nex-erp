/**
 * READ-ONLY. Compares MIRA's reporting lines with Workway for Sunit Kumar's team.
 *
 * Workway (15 Oct 2026): Sunit Kumar reports to Mrs Arshi Badar, and ten people
 * report to Sunit Kumar. This prints, for each person, who MIRA says their
 * manager is, and whether that matches. It writes nothing.
 *
 *   node scripts/check-sunit-kumar-team.js
 *
 * Names are matched loosely (case, spacing, the "Mrs" prefix, a bracketed
 * nickname) because the two systems spell people differently. A name that
 * matches nobody, or more than one person, is reported rather than guessed.
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const LEAD = 'Sunit Kumar';
const LEADS_MANAGER = 'Arshi Badar';
const TEAM = [
  'Shabboo', // Workway shows "Shabboo (Shamayra)"
  'Mayank Karki',
  'Niraj Yadav',
  'Ashish Kumar Mandal',
  'Prince Kumar',
  'Khusbu Parveen',
  'Amrit Thakur',
  'Bhanu Pratap Singh',
  'Jayant Verma',
  'Ayushman Singh',
];

const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/^(mrs?|ms|miss)\.?\s+/, '').replace(/\s+/g, ' ').trim();
const full = (e) => `${e.firstName || ''} ${e.lastName || ''}`.trim();

(async () => {
  const people = await prisma.employee.findMany({
    select: {
      id: true, firstName: true, lastName: true, employeeCode: true, companyId: true,
      user: { select: { email: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  /** Everyone whose name matches: whole name first, then first name alone, then a name that contains it. */
  const find = (name) => {
    const n = norm(name);
    let hits = people.filter((e) => norm(full(e)) === n);
    if (!hits.length) hits = people.filter((e) => norm(e.firstName) === n);
    if (!hits.length) hits = people.filter((e) => norm(full(e)).includes(n));
    return hits;
  };
  const one = (name) => {
    const hits = find(name);
    if (hits.length === 1) return { emp: hits[0] };
    return { problem: hits.length ? `${hits.length} people match: ${hits.map((h) => `${full(h)} #${h.id}`).join(', ')}` : 'nobody in MIRA matches this name' };
  };
  const label = (e) => (e ? `${full(e)} (#${e.id}${e.employeeCode ? `, code ${e.employeeCode}` : ''})` : '—');

  console.log('READ-ONLY — nothing is written\n');

  const lead = one(LEAD);
  const leadsManager = one(LEADS_MANAGER);
  let ok = 0, wrong = 0, unclear = 0;

  // 1. Sunit Kumar → Arshi Badar
  if (lead.problem || leadsManager.problem) {
    console.log(`  ?  ${LEAD} → ${LEADS_MANAGER}:  ${lead.problem || leadsManager.problem}`);
    unclear++;
  } else if (lead.emp.manager?.id === leadsManager.emp.id) {
    console.log(`  ✓  ${label(lead.emp)} reports to ${label(leadsManager.emp)}`);
    ok++;
  } else {
    console.log(`  ✗  ${label(lead.emp)} reports to ${label(lead.emp.manager)} in MIRA — Workway says ${label(leadsManager.emp)}`);
    wrong++;
  }

  // 2. The team → Sunit Kumar
  console.log(`\n  Team that should report to ${LEAD}:`);
  for (const name of TEAM) {
    const p = one(name);
    if (p.problem) { console.log(`  ?  ${name}:  ${p.problem}`); unclear++; continue; }
    if (!lead.emp) { console.log(`  ?  ${label(p.emp)}:  MIRA manager is ${label(p.emp.manager)} (could not identify ${LEAD})`); unclear++; continue; }
    if (p.emp.manager?.id === lead.emp.id) {
      console.log(`  ✓  ${label(p.emp)}`);
      ok++;
    } else {
      console.log(`  ✗  ${label(p.emp)} — MIRA manager is ${label(p.emp.manager)}`);
      wrong++;
    }
  }

  // 3. Anyone MIRA has under Sunit Kumar who is not on the Workway list
  if (lead.emp) {
    const listed = new Set(TEAM.map((n) => one(n).emp?.id).filter(Boolean));
    const extra = people.filter((e) => e.manager?.id === lead.emp.id && !listed.has(e.id));
    if (extra.length) {
      console.log(`\n  In MIRA under ${LEAD} but not on the Workway list:`);
      for (const e of extra) console.log(`  +  ${label(e)}`);
    }
  }

  console.log(`\n  match: ${ok}   different: ${wrong}   could not check: ${unclear}`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
