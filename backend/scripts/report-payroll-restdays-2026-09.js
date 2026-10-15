/**
 * READ-ONLY. How the 15 Oct 2026 rest-day fix changes a month's payroll.
 *
 *   node scripts/report-payroll-restdays-2026-09.js [year] [month]
 *
 * Old rule: branch weekly offs only. New rule (common/rest-day.ts): roster row,
 * else a shift that leaves days out, else branch. Lists everyone whose working
 * days or unattended working days differ. Leave is not netted off, so treat
 * "absent" as days the payroll run has to excuse or deduct. Writes nothing.
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });
const year = Number(process.argv[2] || 2026);
const month = Number(process.argv[3] || 9);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function branchOff(date, weeklyOffs) {
  const raw = (weeklyOffs || '').trim();
  const rules = raw ? raw.split(',').map((r) => r.trim()).filter(Boolean) : ['0'];
  const d = date.getUTCDay(), occ = Math.ceil(date.getUTCDate() / 7);
  return rules.some((r) => {
    const [dp, c = 'all'] = r.split(':');
    if (parseInt(dp, 10) !== d) return false;
    return c === 'all' || (c === 'even' && occ % 2 === 0) || (c === 'odd' && occ % 2 === 1);
  });
}
function restDay(date, entry, shiftDays, weeklyOffs) {
  if (entry && (entry.isDayOff || entry.onsiteApprovalStatus !== 'PENDING')) return entry.isDayOff;
  const days = (shiftDays || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (days.length && days.length < 7) return !days.includes(DAY_NAMES[date.getUTCDay()]);
  return branchOff(date, weeklyOffs);
}
const key = (d) => d.toISOString().slice(0, 10);

(async () => {
  console.log(`READ-ONLY — ${year}-${String(month).padStart(2, '0')}\n`);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = new Date(Date.UTC(year, month - 1, 1)), end = new Date(Date.UTC(year, month - 1, last));
  const holidays = new Set((await prisma.holiday.findMany({ where: { date: { gte: start, lte: end } }, select: { date: true } })).map((h) => key(h.date)));
  const emps = await prisma.employee.findMany({
    where: { allowPayrollGenerate: true, user: { status: { not: 'SUSPENDED' } } },
    select: { id: true, firstName: true, lastName: true, shift: { select: { workingDays: true } }, branch: { select: { weeklyOffs: true } } },
  });
  let changed = 0;
  for (const e of emps) {
    const [rows, atts] = await Promise.all([
      prisma.shiftRosterEntry.findMany({ where: { employeeId: e.id, date: { gte: start, lte: end } }, select: { date: true, isDayOff: true, onsiteApprovalStatus: true } }),
      prisma.attendance.findMany({ where: { employeeId: e.id, date: { gte: start, lte: end } }, select: { date: true, status: true, clockOutApproval: true } }),
    ]);
    const roster = new Map(rows.map((r) => [key(r.date), r]));
    const attended = new Set(atts.filter((a) => a.status !== 'ABSENT' && a.clockOutApproval !== 'PENDING' && a.clockOutApproval !== 'REJECTED').map((a) => key(a.date)));
    let oldW = 0, newW = 0, oldA = 0, newA = 0;
    const flips = [];
    for (let d = 1; d <= last; d++) {
      const date = new Date(Date.UTC(year, month - 1, d)), k = key(date);
      if (holidays.has(k)) continue;
      const o = !branchOff(date, e.branch?.weeklyOffs || '0');
      const n = !restDay(date, roster.get(k), e.shift?.workingDays, e.branch?.weeklyOffs || '0');
      if (o) { oldW++; if (!attended.has(k)) oldA++; }
      if (n) { newW++; if (!attended.has(k)) newA++; }
      if (o !== n) flips.push(`${k.slice(5)} ${DAY_NAMES[date.getUTCDay()].slice(0, 3)}→${n ? 'work' : 'rest'}`);
    }
    if (oldW === newW && oldA === newA) continue;
    changed++;
    console.log(`${e.firstName} ${e.lastName || ''} (#${e.id}): working ${oldW}→${newW}, absent ${oldA}→${newA}`);
    console.log(`   ${flips.join(', ')}`);
  }
  console.log(`\n${changed} of ${emps.length} people change.`);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
