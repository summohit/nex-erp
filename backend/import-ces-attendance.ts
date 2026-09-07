/**
 * Import a scraped month of CES Tech attendance into NEX ERP.
 *
 * Reads scraper/out_hr/attendance-<year>-<month>.json (one object per employee
 * with a per-day `records` list), matches employees by email, and upserts an
 * Attendance row per employee-day (unique on employeeId+date) plus AttendanceLog
 * rows for each punch pair. Idempotent.
 *
 *   npx ts-node import-ces-attendance.ts --file ../scraper/out_hr/attendance-2025-08.json          # dry run
 *   npx ts-node import-ces-attendance.ts --file ../scraper/out_hr/attendance-2025-08.json --commit
 *
 * Status mapping (Workway -> ERP): PRESENT->PRESENT, LATE->PRESENT (isLate),
 * HALF_DAY->HALF_DAY, ABSENT->ABSENT, ON_LEAVE->ON_LEAVE, HOLIDAY->HOLIDAY,
 * DAY_OFF->WEEKLY_OFF. Times are treated as IST (+05:30).
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}
const FILE = getArg('file');
const COMMIT = process.argv.includes('--commit');
const COMPANY_ARG = getArg('company') ? parseInt(getArg('company')!, 10) : null;
const LIMIT = getArg('limit') ? parseInt(getArg('limit')!, 10) : 0;

if (!FILE) {
  console.error('Usage: npx ts-node import-ces-attendance.ts --file <attendance.json> [--commit] [--company <id>] [--limit <n>]');
  process.exit(1);
}

const STATUS_MAP: Record<string, string> = {
  PRESENT: 'PRESENT', LATE: 'PRESENT', HALF_DAY: 'HALF_DAY', ABSENT: 'ABSENT',
  ON_LEAVE: 'ON_LEAVE', HOLIDAY: 'HOLIDAY', DAY_OFF: 'WEEKLY_OFF',
};

/** "01-08-2025 09:30 am" -> Date (interpreted as IST, +05:30). */
function parseIST(dt: string | null | undefined): Date | null {
  if (!dt) return null;
  const m = dt.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let [, dd, mo, yyyy, hh, mm, ap] = m;
  let h = parseInt(hh, 10) % 12;
  if (/pm/i.test(ap)) h += 12;
  const iso = `${yyyy}-${mo}-${dd}T${String(h).padStart(2, '0')}:${mm}:00+05:30`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** "2025-08-01" -> Date at UTC midnight (for the @db.Date column). */
function parseDay(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

interface Rec {
  date: string; day: number; status: string; attendance_id: string | null;
  clock_in?: string | null; clock_out?: string | null;
  logs?: { clock_in: string | null; clock_out: string | null }[];
}
interface Emp { workway_id: string; name: string; email: string; records: Rec[]; }

const report = {
  employeesMatched: 0, employeesUnmatched: [] as string[],
  attendanceCreated: 0, attendanceUpdated: 0, logsCreated: 0,
  byStatus: {} as Record<string, number>, failed: 0, warnings: [] as string[],
};

async function main() {
  const employees = JSON.parse(fs.readFileSync(path.resolve(FILE!), 'utf-8')) as Emp[];
  console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${employees.length} employee(s) from ${path.basename(FILE!)}\n`);

  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const companyId = COMPANY_ARG || (companies.length === 1 ? companies[0].id : null);
  if (!companyId) { console.error('Pass --company <id>'); process.exit(1); }

  // email -> employeeId
  const emps = await prisma.employee.findMany({
    where: { companyId }, select: { id: true, user: { select: { email: true } } },
  });
  const emailToId = new Map(emps.map(e => [e.user.email.toLowerCase(), e.id]));

  // Flatten to rows, matching employees by email. Bulk-insert per month:
  // delete the month's rows for these employees, then createMany (fast + idempotent).
  const attRows: { employeeId: number; date: Date; status: string; isLate: boolean;
                   clockIn: Date | null; clockOut: Date | null;
                   logs: { clockIn: Date; clockOut: Date | null }[] }[] = [];
  const matchedIds = new Set<number>();
  let minDate: Date | null = null, maxDate: Date | null = null;

  let processed = 0;
  for (const emp of employees) {
    if (LIMIT && processed >= LIMIT) break;
    const email = (emp.email || '').toLowerCase();
    const employeeId = email ? emailToId.get(email) : undefined;
    if (!employeeId) { report.employeesUnmatched.push(emp.name || emp.workway_id); continue; }
    report.employeesMatched++; processed++;
    matchedIds.add(employeeId);

    for (const rec of emp.records) {
      const status = STATUS_MAP[rec.status] || 'ABSENT';
      report.byStatus[status] = (report.byStatus[status] || 0) + 1;
      const date = parseDay(rec.date);
      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;
      const logs = (rec.logs || [])
        .map(l => ({ clockIn: parseIST(l.clock_in), clockOut: parseIST(l.clock_out) }))
        .filter((l): l is { clockIn: Date; clockOut: Date | null } => l.clockIn !== null);
      attRows.push({ employeeId, date, status, isLate: rec.status === 'LATE',
                     clockIn: parseIST(rec.clock_in), clockOut: parseIST(rec.clock_out), logs });
    }
  }

  if (COMMIT && matchedIds.size && minDate && maxDate) {
    const ids = [...matchedIds];
    // Clean slate for this month/these employees (cascades to logs), then bulk insert.
    await prisma.attendance.deleteMany({
      where: { employeeId: { in: ids }, date: { gte: minDate, lte: maxDate } },
    });
    const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
    for (const c of chunk(attRows, 1000)) {
      await prisma.attendance.createMany({
        data: c.map(r => ({ employeeId: r.employeeId, date: r.date, status: r.status,
                            isLate: r.isLate, clockIn: r.clockIn, clockOut: r.clockOut })),
      });
      report.attendanceCreated += c.length;
    }
    // Attach punch logs to the rows that have them.
    const withLogs = attRows.filter(r => r.logs.length);
    if (withLogs.length) {
      const created = await prisma.attendance.findMany({
        where: { employeeId: { in: ids }, date: { gte: minDate, lte: maxDate } },
        select: { id: true, employeeId: true, date: true },
      });
      const key = (e: number, d: Date) => `${e}|${d.toISOString().slice(0, 10)}`;
      const idMap = new Map(created.map(a => [key(a.employeeId, a.date), a.id]));
      const logData: { attendanceId: number; clockIn: Date; clockOut: Date | null }[] = [];
      for (const r of withLogs) {
        const aid = idMap.get(key(r.employeeId, r.date));
        if (!aid) continue;
        for (const lg of r.logs) logData.push({ attendanceId: aid, clockIn: lg.clockIn, clockOut: lg.clockOut });
      }
      for (const c of chunk(logData, 1000)) {
        await prisma.attendanceLog.createMany({ data: c });
        report.logsCreated += c.length;
      }
    }
  } else {
    report.attendanceCreated = attRows.length;
  }

  console.log('\n──────── report ────────');
  console.log(`employees matched: ${report.employeesMatched}, unmatched: ${report.employeesUnmatched.length}`);
  if (report.employeesUnmatched.length)
    console.log(`  unmatched: ${report.employeesUnmatched.slice(0, 20).join(', ')}`);
  console.log(`attendance rows: ${report.attendanceCreated} to create, ${report.attendanceUpdated} updated`);
  console.log(`punch logs created: ${report.logsCreated}`);
  console.log(`by ERP status: ${JSON.stringify(report.byStatus)}`);
  console.log(`failed: ${report.failed}`);
  if (report.warnings.length) report.warnings.slice(0, 15).forEach(w => console.log(`  - ${w}`));
  console.log(COMMIT ? '\nDONE.' : '\nDRY RUN — re-run with --commit.');
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
