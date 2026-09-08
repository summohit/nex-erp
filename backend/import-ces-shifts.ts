/**
 * Import CES Tech (Worksuite) shift definitions and roster assignments.
 *
 *   Shift            <- the six shifts from Workway's attendance settings
 *   Employee.shiftId <- each employee's predominant shift from the weekly roster
 *
 *   npx ts-node import-ces-shifts.ts --file ../scraper/out_hr/shifts.json            # dry run
 *   npx ts-node import-ces-shifts.ts --file ../scraper/out_hr/shifts.json --commit
 *
 * Workway rosters shifts per employee PER DAY, while our Employee holds a single
 * shift. The scraper reduces each person's sampled weeks to their most frequent
 * shift; that is what lands here. Workway's roster is sparse — most cells are
 * unassigned — so employees with no roster evidence keep whatever shift they
 * already have rather than being cleared.
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
  console.error('Usage: npx ts-node import-ces-shifts.ts --file <shifts.json> [--commit]');
  process.exit(1);
}

const num = (v: any): number | null => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
};

const report = {
  shiftsCreated: 0, shiftsUpdated: 0,
  assigned: 0, unchanged: 0,
  noRosterEvidence: [] as string[],
  unmatchedEmployees: [] as string[],
  unmatchedShiftNames: new Set<string>(),
};

async function main() {
  const data = JSON.parse(fs.readFileSync(path.resolve(FILE!), 'utf-8'));
  const types: any[] = data.types || [];
  const defaults: any[] = data.defaults || [];
  console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${types.length} shift(s), ${defaults.length} roster employee(s)\n`);

  // ── 1. shift definitions ───────────────────────────────────────────────
  const existing = await prisma.shift.findMany({ where: { companyId: COMPANY_ID } });
  const byName = new Map(existing.map(s => [s.name.trim().toLowerCase(), s]));
  const shiftIdFor = new Map<string, number>();

  for (const t of types) {
    const payload = {
      name: t.name,
      companyId: COMPANY_ID,
      shortCode: t.short_code || null,
      colorCode: t.color || null,
      shiftType: (t.shift_type || 'strict').toUpperCase(),
      startTime: t.start_time || null,
      endTime: t.end_time || null,
      halfDayTime: t.half_day_time || null,
      halfDayHours: num(t.half_day_hours),
      totalHours: num(t.total_hours),
      earlyClockInMinutes: num(t.early_clock_in_minutes) ?? 0,
      autoClockOutHours: num(t.auto_clock_out_hours) ?? 0,
      // Workway calls this "late mark after (minutes)"; ours is the same grace period.
      bufferTimeMinutes: num(t.late_mark_minutes) ?? 15,
      maxCheckIns: num(t.max_check_ins) ?? 2,
      workingDays: (t.working_days || []).length ? (t.working_days as string[]).join(',') : null,
    };
    const hit = byName.get(t.name.trim().toLowerCase());
    if (hit) {
      if (COMMIT) await prisma.shift.update({ where: { id: hit.id }, data: payload });
      shiftIdFor.set(t.name, hit.id);
      report.shiftsUpdated++;
    } else {
      let id = -1;
      if (COMMIT) id = (await prisma.shift.create({ data: payload })).id;
      shiftIdFor.set(t.name, id);
      report.shiftsCreated++;
    }
    const when = payload.shiftType === 'FLEXIBLE'
      ? `${payload.totalHours}h day / ${payload.halfDayHours}h half`
      : `${payload.startTime}-${payload.endTime} (half at ${payload.halfDayTime})`;
    console.log(`  ${hit ? 'update' : 'create'} ${t.name.padEnd(16)} ${payload.shiftType.padEnd(8)} ${when}, ` +
                `late after ${payload.bufferTimeMinutes}m, early ${payload.earlyClockInMinutes}m, ` +
                `max ${payload.maxCheckIns} check-ins, ${(t.working_days || []).length} working days`);
  }

  // ── 2. per-employee assignment ─────────────────────────────────────────
  // Roster rows identify employees by Workway user id; bridge to email via the
  // employee export, the same way the leave import does.
  const bridge = JSON.parse(fs.readFileSync(
    path.resolve(path.dirname(FILE!), 'cestech-full.json'), 'utf-8'));
  const wwIdToEmail = new Map<string, string>();
  for (const e of bridge) {
    const em = (e.profile?.email || '').toLowerCase();
    if (e.id && em) wwIdToEmail.set(String(e.id), em);
  }

  const emps = await prisma.employee.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, firstName: true, lastName: true, shiftId: true, user: { select: { email: true } } },
  });
  const byEmail = new Map(emps.map(e => [e.user.email.toLowerCase(), e]));

  for (const d of defaults) {
    if (!d.shift) {
      report.noRosterEvidence.push(d.label);
      continue;
    }
    const email = wwIdToEmail.get(String(d.user_id));
    const emp = email ? byEmail.get(email) : undefined;
    if (!emp) { report.unmatchedEmployees.push(d.label); continue; }
    const sid = shiftIdFor.get(d.shift);
    if (sid === undefined) { report.unmatchedShiftNames.add(d.shift); continue; }

    if (emp.shiftId === sid) { report.unchanged++; continue; }
    if (COMMIT && sid > 0) {
      await prisma.employee.update({ where: { id: emp.id }, data: { shiftId: sid } });
    }
    report.assigned++;
  }

  console.log('\n──────── report ────────');
  console.log(`Shifts:      ${report.shiftsCreated} created, ${report.shiftsUpdated} updated`);
  console.log(`Assignments: ${report.assigned} changed, ${report.unchanged} already correct`);
  console.log(`  on the roster but never assigned a shift in Workway: ${report.noRosterEvidence.length}`);
  console.log(`  (these keep their current ERP shift — Workway has no answer for them)`);
  if (report.unmatchedEmployees.length)
    console.log(`  roster rows not matched to an ERP employee: ${report.unmatchedEmployees.length} — ${report.unmatchedEmployees.slice(0, 5).join(', ')}`);
  if (report.unmatchedShiftNames.size)
    console.log(`  unknown shift names: ${[...report.unmatchedShiftNames].join(', ')}`);
  console.log(COMMIT ? '\nDONE — committed.' : '\nDRY RUN — re-run with --commit.');
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
