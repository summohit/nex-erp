/**
 * One-off repair for attendance rows filed one day early by the old istDateKey().
 *
 * istDateKey() used to return IST-midnight as a UTC instant (18:30 the previous
 * day). Attendance.date is a Postgres `date` column, so that truncated to the
 * previous calendar day — every live clock-in landed a day early. The helper is
 * fixed; this moves the already-written rows onto their correct day.
 *
 *   npx ts-node fix-attendance-datekey.ts            # dry run
 *   npx ts-node fix-attendance-datekey.ts --commit
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const COMMIT = process.argv.includes('--commit');
const IST_OFFSET_MS = 330 * 60_000;

/** UTC midnight of the IST calendar day containing `d` (matches the fixed istDateKey). */
function istDay(d: Date): Date {
  return new Date(new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10) + 'T00:00:00Z');
}

async function main() {
  console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — repairing one-day-early attendance rows\n`);

  const rows = await prisma.attendance.findMany({
    where: { employee: { companyId: 1 }, clockIn: { not: null } },
    select: { id: true, employeeId: true, date: true, clockIn: true, clockOut: true, status: true, isLate: true },
  });

  // Descending by current date: these shifts can chain (Sep1->2, Sep2->3, Sep3->4),
  // so the later row must vacate its slot before the earlier one moves in —
  // otherwise merging would overwrite punch data that still needs to move.
  const bad = rows
    .filter(r => istDay(r.clockIn!).getTime() - r.date.getTime() === 86_400_000)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  console.log(`${bad.length} row(s) stored one day early\n`);

  let shifted = 0, merged = 0;
  for (const r of bad) {
    const want = istDay(r.clockIn!);
    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: r.employeeId, date: want } },
      select: { id: true, status: true },
    });

    const label = `emp${r.employeeId} ${r.date.toISOString().slice(0, 10)} -> ${want.toISOString().slice(0, 10)}`;
    if (existing) {
      console.log(`  MERGE  ${label} (into row ${existing.id}, was ${existing.status})`);
      if (COMMIT) {
        // The real punch data wins over the imported placeholder for that day.
        await prisma.attendance.update({
          where: { id: existing.id },
          data: { clockIn: r.clockIn, clockOut: r.clockOut, status: r.status, isLate: r.isLate },
        });
        await prisma.attendanceLog.updateMany({ where: { attendanceId: r.id }, data: { attendanceId: existing.id } });
        await prisma.attendance.delete({ where: { id: r.id } });
      }
      merged++;
    } else {
      console.log(`  SHIFT  ${label}`);
      if (COMMIT) await prisma.attendance.update({ where: { id: r.id }, data: { date: want } });
      shifted++;
    }
  }

  console.log(`\n${shifted} shifted, ${merged} merged`);
  console.log(COMMIT ? 'DONE.' : 'DRY RUN — re-run with --commit.');
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
