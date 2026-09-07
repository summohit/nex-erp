/**
 * Import CES Tech (Worksuite) leave data into NEX ERP.
 *
 *   LeaveType    <- Workway's leave-type settings (allotment, no. of leaves, paid)
 *   LeaveBalance <- per-employee quotas, year 2026 (Workway's leave year starts in January)
 *   LeaveRequest <- every leave day (multi-day leaves already expanded by the scraper)
 *
 *   npx ts-node import-ces-leaves.ts --file ../scraper/out_hr/leaves.json            # dry run
 *   npx ts-node import-ces-leaves.ts --file ../scraper/out_hr/leaves.json --commit
 *
 * Workway assigns leave by TYPE (scoped to departments/designations, which here
 * resolve to "everyone"), and each employee's quota is pro-rated by joining date.
 * We therefore import each employee's real allotment where we have it. For the
 * employees whose Workway detail page returns 403 we fall back to the leave
 * type's default and flag them, since their true pro-rated figure is unavailable.
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
const YEAR = parseInt(getArg('year') || '2026', 10);

if (!FILE) {
  console.error('Usage: npx ts-node import-ces-leaves.ts --file <leaves.json> [--commit] [--year 2026]');
  process.exit(1);
}

/** Workway type name -> an existing ERP LeaveType name, where one already fits. */
const TYPE_ALIAS: Record<string, string> = {
  'Comp-Off': 'Compensatory Off',
  'Unpaid Leaves': 'Loss of Pay',
};

const report = {
  typesCreated: 0, typesUpdated: 0,
  balancesExact: 0, balancesDefaulted: 0, balancesProbation: 0,
  requestsCreated: 0,
  employeesUnmatched: new Set<string>(),
  defaultedEmployees: new Set<string>(),
  probationEmployees: new Set<string>(),
  typeUnmatched: new Set<string>(),
  warnings: [] as string[],
};

/** "11-09-2026 (Friday)" or "11-09-2026" -> Date at UTC midnight. */
function parseDate(s: string): Date | null {
  const m = String(s || '').match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return null;
  const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

const num = (v: any) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };

/** Statuses arrive concatenated ("Approved Pre-Approved") — keep the first word. */
function mapLeaveStatus(s: string): string {
  const v = String(s || '').trim().toLowerCase();
  if (v.startsWith('reject')) return 'REJECTED';
  if (v.startsWith('pending')) return 'PENDING';
  if (v.startsWith('approved')) return 'APPROVED';
  return 'PENDING';
}

/** Some rows carry the half-day marker inside the type name. */
function splitType(raw: string): { name: string; half: '' | 'AM' | 'PM' } {
  let name = String(raw || '').trim();
  let half: '' | 'AM' | 'PM' = '';
  if (/\bfirst half$/i.test(name)) { half = 'AM'; name = name.replace(/\s*first half$/i, ''); }
  else if (/\bsecond half$/i.test(name)) { half = 'PM'; name = name.replace(/\s*second half$/i, ''); }
  return { name: name.trim(), half };
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.resolve(FILE!), 'utf-8'));
  const types: any[] = data.types || [];
  const records: any[] = data.records || [];
  const quotas: any[] = data.quotas || [];
  console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${types.length} type(s), ${records.length} leave day(s), ${quotas.length} quota row(s)\n`);

  // ── employees: Workway user_id / email -> our Employee id ──────────────
  const emps = await prisma.employee.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, employeeCode: true, firstName: true, lastName: true, user: { select: { email: true } } },
  });
  const byEmail = new Map(emps.map(e => [e.user.email.toLowerCase(), e.id]));
  const labelByEmail = new Map(emps.map(e =>
    [e.user.email.toLowerCase(), `${e.employeeCode || ''},${e.firstName} ${e.lastName}`]));

  // The leave records identify employees by Workway user_id, so bridge through
  // the employee export that already pairs those ids with emails.
  const bridge = JSON.parse(fs.readFileSync(
    path.resolve(path.dirname(FILE!), 'cestech-full.json'), 'utf-8'));
  const wwIdToEmail = new Map<string, string>();
  for (const e of bridge) {
    const em = (e.profile?.email || '').toLowerCase();
    if (e.id && em) wwIdToEmail.set(String(e.id), em);
  }
  const empByWwId = (id: any) => {
    const em = wwIdToEmail.get(String(id));
    return em ? byEmail.get(em) : undefined;
  };

  // ── 1. leave types ─────────────────────────────────────────────────────
  const existingTypes = await prisma.leaveType.findMany({ where: { companyId: COMPANY_ID } });
  const typeByName = new Map(existingTypes.map(t => [t.name.toLowerCase(), t]));
  const typeIdFor = new Map<string, number>();   // Workway name -> LeaveType id

  for (const t of types) {
    const wwName: string = t.name;
    const target = TYPE_ALIAS[wwName] || wwName;
    const existing = typeByName.get(target.toLowerCase());
    const payload = {
      name: target,
      companyId: COMPANY_ID,
      defaultDays: Math.round(num(t.no_of_leaves)),
      accrualFrequency: /month/i.test(t.allotment_type) ? 'MONTHLY'
                      : /year/i.test(t.allotment_type) ? 'YEARLY' : 'NONE',
      isPaid: !/unpaid/i.test(t.paid_status),
      allowHalfDay: true,
    };
    if (existing) {
      if (COMMIT) await prisma.leaveType.update({ where: { id: existing.id }, data: payload });
      typeIdFor.set(wwName, existing.id);
      report.typesUpdated++;
    } else {
      let id = -1;
      if (COMMIT) id = (await prisma.leaveType.create({ data: payload })).id;
      typeIdFor.set(wwName, id);
      report.typesCreated++;
    }
    console.log(`  type ${wwName}${target !== wwName ? ` -> ${target}` : ''}: ` +
                `${payload.defaultDays} days, ${payload.accrualFrequency}, ${payload.isPaid ? 'paid' : 'unpaid'}`);
  }
  const typeDefault = new Map(types.map(t => [t.name, Math.round(num(t.no_of_leaves))]));

  // ── 2. leave balances ──────────────────────────────────────────────────
  // Exact allotments where Workway gave them to us.
  const quotaByEmp = new Map<string, any[]>();
  for (const q of quotas) {
    const em = (q.email || '').toLowerCase();
    if (!em) continue;
    (quotaByEmp.get(em) || quotaByEmp.set(em, []).get(em)!).push(q);
  }

  const balanceRows: { employeeId: number; leaveTypeId: number; allocated: number; used: number }[] = [];

  for (const [email, empId] of byEmail) {
    const qs = quotaByEmp.get(email);
    if (!qs || !qs.length) continue;
    const seen = new Set<string>();
    for (const q of qs) {
      const tid = typeIdFor.get(q.leave_type);
      if (tid === undefined) { report.typeUnmatched.add(q.leave_type); continue; }
      seen.add(q.leave_type);
      balanceRows.push({ employeeId: empId, leaveTypeId: tid,
                         allocated: num(q.no_of_leaves), used: num(q.total_leaves_taken) });
      report.balancesExact++;
    }
    // Workway withholds the yearly Casual/Sick allotment for an employee's first
    // year, so those quota rows simply don't exist for 2026 joiners. Create the
    // balance at zero rather than granting the type default they haven't earned.
    for (const t of types) {
      if (seen.has(t.name)) continue;
      const tid = typeIdFor.get(t.name);
      if (tid === undefined) continue;
      balanceRows.push({ employeeId: empId, leaveTypeId: tid, allocated: 0, used: 0 });
      report.balancesProbation++;
      report.probationEmployees.add(email);
    }
  }

  // Employees with no quota data (their Workway detail page 403s): fall back to
  // the leave type's default allotment and record them for HR to review. Their
  // days *taken* we can still count exactly, from the leave records themselves.
  const takenByEmail = new Map<string, Map<string, number>>();
  for (const r of records) {
    if (mapLeaveStatus(r.status) !== 'APPROVED') continue;
    const email = wwIdToEmail.get(String(r.user_id));
    if (!email) continue;
    const typeName = r.type_name || splitType(r.leave_type).name;
    const days = /half/i.test(r.duration || '') || r.half_day_type ? 0.5 : 1;
    const m = takenByEmail.get(email) || takenByEmail.set(email, new Map()).get(email)!;
    m.set(typeName, (m.get(typeName) || 0) + days);
  }

  const withQuota = new Set([...quotaByEmp.keys()]);
  const wwEmails = new Set([...wwIdToEmail.values()]);
  for (const [email, empId] of byEmail) {
    if (withQuota.has(email) || !wwEmails.has(email)) continue;
    report.defaultedEmployees.add(email);
    for (const t of types) {
      const tid = typeIdFor.get(t.name);
      if (tid === undefined) continue;
      balanceRows.push({ employeeId: empId, leaveTypeId: tid,
                         allocated: typeDefault.get(t.name) || 0,
                         used: takenByEmail.get(email)?.get(t.name) || 0 });
      report.balancesDefaulted++;
    }
  }

  if (COMMIT) {
    for (const b of balanceRows) {
      await prisma.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: YEAR } },
        update: { allocated: b.allocated, used: b.used },
        create: { ...b, year: YEAR, carriedOver: 0 },
      });
    }
  }

  // ── 3. leave requests ──────────────────────────────────────────────────
  const requests: any[] = [];
  for (const r of records) {
    const empId = empByWwId(r.user_id);
    if (!empId) { report.employeesUnmatched.add(String(r.employee_name || r.user_id)); continue; }
    // `type_name` is the clean base type; `leave_type` may carry a half-day suffix.
    const fromName = splitType(r.leave_type);
    const typeName = r.type_name || fromName.name;
    const tid = typeIdFor.get(typeName);
    if (tid === undefined) { report.typeUnmatched.add(typeName); continue; }
    const date = parseDate(r.leave_date || r.date);
    if (!date) { report.warnings.push(`unparseable leave date: ${r.leave_date}`); continue; }

    const hd = String(r.half_day_type || '');
    const half = hd === 'first_half' ? 'AM' : hd === 'second_half' ? 'PM' : fromName.half;
    const status = mapLeaveStatus(r.status);
    requests.push({
      employeeId: empId, leaveTypeId: tid,
      startDate: date, endDate: date,
      isHalfDay: !!half || /half/i.test(r.duration || ''),
      halfDayPeriod: half || null,
      reason: r.reason || null,
      status,
      rejectionReason: status === 'REJECTED' ? (r.reject_reason || null) : null,
    });
  }
  report.requestsCreated = requests.length;

  if (COMMIT && requests.length) {
    // Re-runnable: clear this year's imported requests for these employees first.
    const empIds = [...new Set(requests.map(r => r.employeeId))];
    await prisma.leaveRequest.deleteMany({
      where: { employeeId: { in: empIds },
               startDate: { gte: new Date(`${YEAR}-01-01T00:00:00Z`), lte: new Date(`${YEAR}-12-31T23:59:59Z`) } },
    });
    for (let i = 0; i < requests.length; i += 500) {
      await prisma.leaveRequest.createMany({ data: requests.slice(i, i + 500) });
    }
  }

  console.log('\n──────── report ────────');
  console.log(`Leave types:    ${report.typesCreated} created, ${report.typesUpdated} updated`);
  console.log(`Leave balances: ${report.balancesExact} exact (from Workway quotas), ${report.balancesDefaulted} type-default, ${report.balancesProbation} zeroed`);
  console.log(`  employees on type-defaults (no quota available): ${report.defaultedEmployees.size}`);
  console.log(`  employees with a type zeroed (2026 joiner, not yet allotted): ${report.probationEmployees.size}`);
  console.log(`Leave requests: ${report.requestsCreated}`);
  if (report.employeesUnmatched.size)
    console.log(`  unmatched employees: ${[...report.employeesUnmatched].slice(0, 8).join(', ')}`);
  if (report.typeUnmatched.size)
    console.log(`  unmatched leave types: ${[...report.typeUnmatched].join(', ')}`);
  if (report.warnings.length) report.warnings.slice(0, 5).forEach(w => console.log(`  - ${w}`));

  // Leave HR a list of everyone whose allotment we could not take from Workway.
  if (report.defaultedEmployees.size || report.probationEmployees.size) {
    const out = path.resolve('leave-balances-to-review.csv');
    const line = (email: string, why: string) => `${labelByEmail.get(email) || ','},${email},${why}`;
    fs.writeFileSync(out, 'employee_code,name,email,reason\n' +
      [...[...report.defaultedEmployees].map(e => line(e, 'type default - Workway page inaccessible')),
       ...[...report.probationEmployees].map(e => line(e, 'zeroed - 2026 joiner, no allotment in Workway'))
      ].join('\n') + '\n');
    console.log(`\n  review list written to ${out}`);
  }
  console.log(COMMIT ? '\nDONE — committed.' : '\nDRY RUN — re-run with --commit.');
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
