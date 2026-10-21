/**
 * Set each person's own weekly off (21 Oct 2026), from the October roster
 * analysis HR confirmed. Shows the list first; saves only with --apply.
 *
 *   node scripts/set-weekly-offs.js
 *   node scripts/set-weekly-offs.js --apply
 *
 * Format as Branch.weeklyOffs: day 0 (Sun) .. 6 (Sat), ":even" = 2nd/4th.
 * Everyone not listed below gets the standard "Sun + 2nd/4th Sat".
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const STANDARD = '0,6:even';
const BY_CODE = {
  '20111': '1',   // Arshi Badar      — Monday
  '20237': '1',   // Khusbu Parveen   — Monday
  '20117': '1',   // Sunit Kumar      — Monday
  '20182': '2',   // Prashant Rao     — Tuesday
  'C006': '0,6',  // Pradyumna Kumar Sahu — Sunday + every Saturday
  '20145': 'NONE',// Gopal            — works every day
};
const LABEL = (v) => ({ '0,6:even': 'Sun + 2nd/4th Sat', '1': 'Mon', '2': 'Tue', '0,6': 'Sun + every Sat', 'NONE': 'none (works every day)' }[v] || v);
const apply = process.argv.includes('--apply');

(async () => {
  const people = await prisma.employee.findMany({
    where: { user: { status: { not: 'SUSPENDED' } } },
    select: { id: true, firstName: true, lastName: true, employeeCode: true, weeklyOffs: true },
    orderBy: { firstName: 'asc' },
  });
  const plan = people.map((p) => ({ ...p, next: BY_CODE[p.employeeCode ?? ''] ?? STANDARD }));
  const groups = {};
  for (const p of plan) (groups[LABEL(p.next)] ??= []).push(`${p.firstName} ${p.lastName ?? ''}`.trim() + (p.employeeCode ? ` #${p.employeeCode}` : ''));
  console.log(`\nWeekly off to set for ${plan.length} active people:\n`);
  for (const [k, names] of Object.entries(groups)) {
    console.log(`${k} (${names.length})`);
    console.log('   ' + names.join(', ') + '\n');
  }
  const missing = Object.keys(BY_CODE).filter((c) => !people.some((p) => p.employeeCode === c));
  if (missing.length) console.log(`⚠ Codes not found among active people: ${missing.join(', ')}\n`);
  if (!apply) { console.log('Nothing changed. Run again with --apply to save.\n'); }
  else {
    for (const p of plan) if (p.weeklyOffs !== p.next) await prisma.employee.update({ where: { id: p.id }, data: { weeklyOffs: p.next } });
    console.log(`Done: weekly off saved for ${plan.length} people.\n`);
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
