/**
 * Each person's weekly off, worked out from a rostered month (21 Oct 2026).
 * Read-only: prints a table, changes nothing.
 *   node scripts/detect-weekly-offs.js 10 2026
 *
 * For every weekday we count how many of that month's occurrences were a
 * rostered Day Off. A weekday off on every occurrence is a weekly off; a
 * Saturday off on only the 2nd and 4th (or 1st/3rd/5th) is reported as such.
 * Leave and field-visit days are not counted either way.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const [m, y] = process.argv.slice(2).map(Number);
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);

(async () => {
  const month = m || 10, year = y || 2026;
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const people = await prisma.employee.findMany({
    where: { user: { status: { not: 'SUSPENDED' } } },
    select: {
      id: true, firstName: true, lastName: true, employeeCode: true,
      shift: { select: { name: true } }, branch: { select: { name: true, weeklyOffs: true } },
      department: { select: { name: true } },
    },
    orderBy: { firstName: 'asc' },
  });
  const entries = await prisma.shiftRosterEntry.findMany({
    where: { date: { gte: from, lt: to }, employeeId: { in: people.map((p) => p.id) } },
    select: { employeeId: true, date: true, isDayOff: true },
  });
  const byEmp = new Map();
  for (const e of entries) {
    if (!byEmp.has(e.employeeId)) byEmp.set(e.employeeId, []);
    byEmp.get(e.employeeId).push(e);
  }

  const rows = [];
  for (const p of people) {
    const list = byEmp.get(p.id) || [];
    const name = `${p.firstName} ${p.lastName ?? ''}`.trim() + (p.employeeCode ? ` #${p.employeeCode}` : '');
    if (!list.length) { rows.push({ name, detected: '— no roster this month', p, offDays: '' }); continue; }
    const off = Array.from({ length: 7 }, () => ({ off: 0, total: 0, sat: [] }));
    for (const e of list) {
      const wd = e.date.getUTCDay();
      off[wd].total++;
      if (e.isDayOff) {
        off[wd].off++;
        if (wd === 6) off[wd].sat.push(Math.ceil(e.date.getUTCDate() / 7));
      }
    }
    const parts = [];
    const unclear = [];
    for (let wd = 0; wd < 7; wd++) {
      const { off: o, total: t, sat } = off[wd];
      if (!o) continue;
      if (o === t) parts.push(DAYS[wd]);
      else if (wd === 6 && sat.length && sat.every((n) => n % 2 === 0)) parts.push('2nd/4th Sat');
      else if (wd === 6 && sat.length && sat.every((n) => n % 2 === 1)) parts.push('1st/3rd/5th Sat');
      else unclear.push(`${DAYS[wd]} ${o}/${t}`);
    }
    const detected = parts.length ? parts.join(' + ') : 'none (works every day)';
    rows.push({ name, detected: detected + (unclear.length ? `  ⚠ also off: ${unclear.join(', ')}` : ''), p, offDays: list.filter((e) => e.isDayOff).length });
  }

  console.log(`\nWeekly off by person, from the ${month}/${year} roster (${people.length} active people)\n`);
  console.log(`${pad('Employee', 30)} ${pad('Detected weekly off', 44)} ${pad('Standing shift', 30)} ${pad('Branch', 20)}`);
  console.log('-'.repeat(126));
  rows.sort((a, b) => a.detected.localeCompare(b.detected) || a.name.localeCompare(b.name));
  for (const r of rows) {
    console.log(`${pad(r.name, 30)} ${pad(r.detected, 44)} ${pad(r.p.shift?.name || '—', 30)} ${pad(r.p.branch?.name || '—', 20)}`);
  }
  const groups = {};
  for (const r of rows) { const k = r.detected.split('  ⚠')[0]; groups[k] = (groups[k] || 0) + 1; }
  console.log('\nSummary:');
  for (const [k, n] of Object.entries(groups).sort((a, b) => b[1] - a[1])) console.log(`  ${pad(k, 44)} ${n}`);
  console.log('\n⚠ = some days of that weekday were off, but not all (swaps, one-offs) — check by hand.\n');
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
