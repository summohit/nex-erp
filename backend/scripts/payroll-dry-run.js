/**
 * What a payroll run for a month WOULD pay, without generating anything.
 *
 * Loss of pay is the whole reason this exists. generatePayslips treats any
 * working day with no PRESENT or HALF_DAY attendance row, and no approved
 * leave covering it, as an unexcused absence -- and charges a day's pay for
 * each one:
 *
 *     dailyRate = grossEarnings / workingDaysInMonth
 *     lossOfPay = dailyRate * unexcusedAbsences
 *
 * That is correct arithmetic on top of an attendance record that, for
 * September 2026, is mostly missing. A month where somebody is recorded
 * present four days out of twenty-six is not a month they were absent for
 * twenty-two; it is a month the clock-in was broken and the Workway import
 * only reached so far. Paying from it would deduct most of everybody's salary.
 *
 * So: this replays the same rules and prints the answer BEFORE the button is
 * pressed, rather than after payslips exist.
 *
 *   node scripts/payroll-dry-run.js 9 2026
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const MONTH = Number(process.argv[2] || new Date().getMonth() + 1);
const YEAR = Number(process.argv[3] || new Date().getFullYear());

(async () => {
  const employees = await prisma.employee.findMany({
    where: { user: { status: { not: 'SUSPENDED' } }, allowPayrollGenerate: true },
    include: {
      salaryStructures: { include: { component: true } },
      branch: true,
      user: { select: { email: true } },
    },
  });

  const start = new Date(YEAR, MONTH - 1, 1);
  const end = new Date(YEAR, MONTH, 0);
  const totalDays = end.getDate();

  console.log(`Payroll dry run — ${MONTH}/${YEAR} · ${employees.length} employee(s) eligible\n`);

  const rows = [];
  for (const emp of employees) {
    let gross = 0, deductions = 0;
    for (const s of emp.salaryStructures || []) {
      const amt = s.amount || 0;
      if (s.component?.type === 'EARNING') gross += amt;
      else if (s.component?.type === 'DEDUCTION') deductions += amt;
    }
    if (gross === 0) continue;   // nothing to pay, nothing to warn about

    const offs = (emp.branch?.weeklyOffs || '0').split(',').map((n) => n.trim());
    let workingDays = 0;
    for (let d = 1; d <= totalDays; d++) {
      if (!offs.includes(String(new Date(YEAR, MONTH - 1, d).getDay()))) workingDays++;
    }
    if (workingDays === 0) workingDays = totalDays;

    const attendances = await prisma.attendance.findMany({
      where: { employeeId: emp.id, date: { gte: start, lte: end } },
      select: { date: true, status: true },
    });
    const byDay = new Map();
    let present = 0, half = 0;
    for (const a of attendances) {
      byDay.set(a.date.toISOString().slice(0, 10), a.status);
      if (a.status === 'PRESENT') present++;
      else if (a.status === 'HALF_DAY') half++;
    }

    const leaves = await prisma.leaveRequest.findMany({
      where: { employeeId: emp.id, status: 'APPROVED' },
      select: { startDate: true, endDate: true },
    });

    let absences = 0;
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(YEAR, MONTH - 1, d);
      if (offs.includes(String(date.getDay()))) continue;
      const key = date.toISOString().slice(0, 10);
      const st = byDay.get(key);
      if (st === 'PRESENT' || st === 'HALF_DAY') continue;
      const covered = leaves.some((l) =>
        key >= l.startDate.toISOString().slice(0, 10) && key <= l.endDate.toISOString().slice(0, 10));
      if (!covered) absences++;
    }
    absences += half * 0.5;

    const lop = Math.round((gross / workingDays) * absences * 100) / 100;
    const net = Math.max(0, gross - deductions - lop);
    rows.push({
      name: `${emp.firstName} ${emp.lastName}`.trim(),
      workingDays, present: present + half * 0.5, absences, gross, deductions, lop, net,
      wiped: gross > 0 ? lop / gross : 0,
    });
  }

  rows.sort((a, b) => b.wiped - a.wiped);
  for (const r of rows) {
    console.log(`  ${r.name.slice(0, 22).padEnd(24)} present ${String(r.present).padStart(5)}/${r.workingDays}`
      + `  absent ${String(r.absences).padStart(5)}`
      + `  gross ${r.gross.toFixed(0).padStart(9)}`
      + `  LOP ${r.lop.toFixed(0).padStart(9)}`
      + `  net ${r.net.toFixed(0).padStart(9)}`
      + `  (${(r.wiped * 100).toFixed(0)}% lost)`);
  }

  const totalGross = rows.reduce((t, r) => t + r.gross, 0);
  const totalLop = rows.reduce((t, r) => t + r.lop, 0);
  const totalNet = rows.reduce((t, r) => t + r.net, 0);
  const severe = rows.filter((r) => r.wiped > 0.5).length;

  console.log(`\n  employees with pay   : ${rows.length}`);
  console.log(`  total gross          : ${totalGross.toFixed(2)}`);
  console.log(`  total loss of pay    : ${totalLop.toFixed(2)}   (${(totalLop / totalGross * 100).toFixed(1)}% of gross)`);
  console.log(`  total net            : ${totalNet.toFixed(2)}`);
  console.log(`  losing over half     : ${severe} people`);
  console.log('\nRead-only — no payslip was created or changed.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
