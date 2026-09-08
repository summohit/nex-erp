/**
 * Import CES Tech (Worksuite) shift roster cells into ShiftRosterEntry.
 *
 *   npx ts-node import-ces-roster.ts --file ../scraper/out_hr/shifts.json            # dry run
 *   npx ts-node import-ces-roster.ts --file ../scraper/out_hr/shifts.json --commit
 *
 * The scraped grid holds one cell per employee per day. A cell is a shift name
 * with times, "Day Off", a leave marker, or empty (nothing rostered). Only the
 * first two become roster rows: leave already lives in LeaveRequest and the grid
 * derives it, and an empty cell means no override, which is the absence of a row.
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
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const FILE = getArg('file');
const COMMIT = process.argv.includes('--commit');
const COMPANY_ID = parseInt(getArg('company') || '1', 10);

if (!FILE) {
  console.error('Usage: npx ts-node import-ces-roster.ts --file <shifts.json> [--commit]');
  process.exit(1);
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.resolve(FILE!), 'utf-8'));
  const roster: any[] = data.roster || [];
  const shiftNames: string[] = (data.types || []).map((t: any) => t.name)
    .sort((a: string, b: string) => b.length - a.length);
  console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${roster.length} roster cell(s)\n`);

  // Workway user id -> our Employee id, bridged by email.
  const bridge = JSON.parse(fs.readFileSync(
    path.resolve(path.dirname(FILE!), 'cestech-full.json'), 'utf-8'));
  const wwIdToEmail = new Map<string, string>();
  for (const e of bridge) {
    const em = (e.profile?.email || '').toLowerCase();
    if (e.id && em) wwIdToEmail.set(String(e.id), em);
  }
  const emps = await prisma.employee.findMany({
    where: { companyId: COMPANY_ID }, select: { id: true, user: { select: { email: true } } },
  });
  const byEmail = new Map(emps.map(e => [e.user.email.toLowerCase(), e.id]));

  const shifts = await prisma.shift.findMany({ where: { companyId: COMPANY_ID } });
  const shiftByName = new Map(shifts.map(s => [s.name.trim().toLowerCase(), s.id]));

  const rows: { employeeId: number; date: Date; shiftId: number | null; isDayOff: boolean; companyId: number }[] = [];
  const stats = { shift: 0, dayOff: 0, leave: 0, empty: 0, unmatchedEmp: 0, unmatchedShift: new Set<string>() };
  const dates: string[] = [];

  for (const c of roster) {
    const cell = String(c.cell || '').trim();
    if (!cell) { stats.empty++; continue; }

    const email = wwIdToEmail.get(String(c.user_id));
    const employeeId = email ? byEmail.get(email) : undefined;
    if (!employeeId) { stats.unmatchedEmp++; continue; }

    const date = new Date(`${c.date}T00:00:00Z`);
    if (isNaN(date.getTime())) continue;
    dates.push(c.date);

    if (/^day off/i.test(cell)) {
      rows.push({ employeeId, date, shiftId: null, isDayOff: true, companyId: COMPANY_ID });
      stats.dayOff++;
      continue;
    }

    // Cells read "General Shift 09:30 - 18:30"; match the longest known name.
    const name = shiftNames.find(n => cell.startsWith(n));
    if (!name) { stats.leave++; continue; } // a leave marker, not a shift
    const shiftId = shiftByName.get(name.trim().toLowerCase());
    if (!shiftId) { stats.unmatchedShift.add(name); continue; }

    rows.push({ employeeId, date, shiftId, isDayOff: false, companyId: COMPANY_ID });
    stats.shift++;
  }

  // The same employee/day can appear once per sampled week; keep the last.
  const deduped = new Map<string, typeof rows[number]>();
  for (const r of rows) deduped.set(`${r.employeeId}|${r.date.toISOString().slice(0, 10)}`, r);
  const finalRows = [...deduped.values()];

  const from = dates.length ? dates.slice().sort()[0] : null;
  const to = dates.length ? dates.slice().sort().reverse()[0] : null;
  console.log(`  date range: ${from} .. ${to}`);
  console.log(`  shift cells:    ${stats.shift}`);
  console.log(`  day-off cells:  ${stats.dayOff}`);
  console.log(`  leave markers skipped (already in LeaveRequest): ${stats.leave}`);
  console.log(`  empty cells skipped (nothing rostered):          ${stats.empty}`);
  if (stats.unmatchedEmp) console.log(`  cells for unmatched employees: ${stats.unmatchedEmp}`);
  if (stats.unmatchedShift.size) console.log(`  unknown shifts: ${[...stats.unmatchedShift].join(', ')}`);
  console.log(`  rows to write (deduped): ${finalRows.length}`);

  if (COMMIT && finalRows.length && from && to) {
    // Idempotent: clear the imported window for these employees, then insert.
    const empIds = [...new Set(finalRows.map(r => r.employeeId))];
    await prisma.shiftRosterEntry.deleteMany({
      where: {
        companyId: COMPANY_ID, employeeId: { in: empIds },
        date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
    });
    for (let i = 0; i < finalRows.length; i += 1000) {
      await prisma.shiftRosterEntry.createMany({ data: finalRows.slice(i, i + 1000) });
    }
  }
  console.log(COMMIT ? '\nDONE — committed.' : '\nDRY RUN — re-run with --commit.');
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
