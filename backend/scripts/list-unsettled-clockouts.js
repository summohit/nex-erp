/**
 * Who has days counted as HALF DAY because of the clock-out (19 Oct 2026):
 * missed and open, closed automatically, closed late with a reason, pending,
 * or rejected; none approved. Read-only.
 *
 *   node scripts/list-unsettled-clockouts.js            (this month and last)
 *   node scripts/list-unsettled-clockouts.js 10 2026    (one month)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const [m, y] = process.argv.slice(2).map(Number);
const now = new Date();
const from = m && y ? new Date(Date.UTC(y, m - 1, 1)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const to = m && y ? new Date(Date.UTC(y, m, 1)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

function why(r) {
  if (r.clockOutApproval === 'PENDING') return 'waiting for approval';
  if (r.clockOutApproval === 'REJECTED') return 'rejected';
  if (r.autoClockedOut) return 'closed automatically';
  if (r.clockOutReason) return 'late, not approved';
  return 'missed, still open';
}

(async () => {
  const rows = await prisma.attendance.findMany({
    where: {
      date: { gte: from, lt: to }, clockIn: { not: null },
      NOT: { clockOutApproval: 'APPROVED' },
      OR: [
        { clockOutApproval: { in: ['PENDING', 'REJECTED'] } },
        { autoClockedOut: true }, { clockOutReason: { not: null } },
        { missedClockOut: true, clockOut: null },
      ],
    },
    select: {
      date: true, clockOutApproval: true, autoClockedOut: true, clockOutReason: true, missedClockOut: true, clockOut: true,
      employee: { select: { firstName: true, lastName: true, employeeCode: true } },
    },
    orderBy: [{ employeeId: 'asc' }, { date: 'asc' }],
  });
  const byPerson = new Map();
  for (const r of rows) {
    const name = `${r.employee.firstName} ${r.employee.lastName ?? ''}`.trim() + (r.employee.employeeCode ? ` (#${r.employee.employeeCode})` : '');
    if (!byPerson.has(name)) byPerson.set(name, []);
    byPerson.get(name).push(`${r.date.toISOString().slice(5, 10)} ${why(r)}`);
  }
  console.log(`\nHalf days from the clock-out, ${from.toISOString().slice(0, 10)} to ${new Date(to - 1).toISOString().slice(0, 10)}: ${rows.length} days, ${byPerson.size} people\n`);
  for (const [name, days] of [...byPerson].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(days.length).padStart(3)}  ${name}`);
    for (const d of days) console.log(`       ${d}`);
  }
  console.log('');
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
