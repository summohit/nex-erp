/**
 * Compares Workway leave data with NEX before anything is imported. READ-ONLY:
 * this script never writes to the database.
 *
 *   node scripts/compare-workway-leaves.js --cutover 2026-09-05 [--year 2026] [--company 1]
 *
 * Inputs (from scraper/workway_leaves.py): scraper/out_hr/leaves-records.csv and
 * scraper/out_hr/leaves-quotas.csv. Override with --records / --quotas.
 *
 * The rule being tested: Workway is the truth for leave dated before the
 * cutover, NEX for leave from the cutover on. So for each employee and type
 *
 *   proposed = Workway quota − Workway approved days before cutover
 *                            − NEX approved days from cutover
 *
 * Writes three CSVs to scraper/out_hr/compare/:
 *   balances.csv  one row per employee x leave type: Workway, NEX today, proposed
 *   records.csv   one row per leave day: in both systems, Workway only, NEX only
 *   issues.csv    what needs a decision: negatives, unmatched people and types
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const CUTOVER = val('--cutover');
const YEAR = Number(val('--year')) || 2026;
const COMPANY_ID = Number(val('--company')) || 1;
const OUT_HR = path.join(__dirname, '..', '..', 'scraper', 'out_hr');
const RECORDS = val('--records') || path.join(OUT_HR, 'leaves-records.csv');
const QUOTAS = val('--quotas') || path.join(OUT_HR, 'leaves-quotas.csv');
const OUT_DIR = path.join(OUT_HR, 'compare');

if (!CUTOVER || !/^\d{4}-\d{2}-\d{2}$/.test(CUTOVER)) {
  console.error('Usage: node scripts/compare-workway-leaves.js --cutover YYYY-MM-DD');
  process.exit(1);
}

// ── CSV ────────────────────────────────────────────────────────────────────
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const readCsv = (f) => parseCsv(fs.readFileSync(f, 'utf8'));
const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function writeCsv(file, rows) {
  if (!rows.length) { fs.writeFileSync(file, ''); return; }
  const head = Object.keys(rows[0]);
  fs.writeFileSync(file, [head.join(','), ...rows.map(r => head.map(h => esc(r[h])).join(','))].join('\n') + '\n');
}

// ── Helpers ────────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const round = (n) => Math.round(n * 100) / 100;
const emailOf = (userField) => (String(userField).match(/'email':\s*'([^']+)'/) || [])[1]?.toLowerCase() || '';
/** Workway statuses: "Approved", "Approved Pre-Approved", "Pending ...", "Rejected ...". */
const wwStatus = (s) => String(s).split(' ')[0].toUpperCase();

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
  });
  try {
    const wwRecords = readCsv(RECORDS);
    const wwQuotas = readCsv(QUOTAS);

    const [employees, leaveTypes, balances, requests] = await Promise.all([
      prisma.employee.findMany({
        where: { companyId: COMPANY_ID },
        select: { id: true, firstName: true, lastName: true, employeeCode: true, user: { select: { email: true } } },
      }),
      prisma.leaveType.findMany({ select: { id: true, name: true } }),
      prisma.leaveBalance.findMany({
        where: { year: YEAR, employee: { companyId: COMPANY_ID } },
        select: { employeeId: true, leaveTypeId: true, allocated: true, used: true, carriedOver: true },
      }),
      prisma.leaveRequest.findMany({
        where: {
          employee: { companyId: COMPANY_ID }, deletedAt: null,
          startDate: { lte: new Date(`${YEAR}-12-31T23:59:59Z`) },
          endDate: { gte: new Date(`${YEAR}-01-01T00:00:00Z`) },
        },
        select: { id: true, employeeId: true, leaveTypeId: true, startDate: true, endDate: true, isHalfDay: true, status: true },
      }),
    ]);

    const empByEmail = new Map(employees.filter(e => e.user?.email).map(e => [e.user.email.toLowerCase(), e]));
    const empName = (e) => `${e.firstName} ${e.lastName || ''}`.trim();
    const typeByNorm = new Map(leaveTypes.map(t => [norm(t.name), t]));
    const typeName = new Map(leaveTypes.map(t => [t.id, t.name]));
    const issues = [];
    const issue = (kind, detail, extra = {}) => issues.push({ kind, detail, ...extra });

    const matchType = (name) => typeByNorm.get(norm(name)) || null;
    const missingTypes = new Set();
    const missingEmails = new Set();

    // ── Workway leave days ──────────────────────────────────────────────────
    // key: employeeId|date -> { ...day }
    const wwDays = new Map();
    for (const r of wwRecords) {
      const date = r.date;
      if (!date || !date.startsWith(String(YEAR))) continue;
      const email = emailOf(r.user);
      const emp = empByEmail.get(email);
      if (!emp) { missingEmails.add(email || `(no email) ${r.employee_name}`); continue; }
      const type = matchType(r.type_name);
      if (!type) missingTypes.add(r.type_name);
      const days = r.duration === 'Half Day' ? 0.5 : 1;
      const key = `${emp.id}|${date}`;
      const prev = wwDays.get(key);
      // Keep the approved one if Workway holds several rows for the same day.
      if (prev && prev.status === 'APPROVED') continue;
      wwDays.set(key, {
        emp, date, days, status: wwStatus(r.status),
        typeName: r.type_name, typeId: type?.id ?? null,
        half: r.half_day_type || '', wwId: r.id,
      });
    }

    // ── NEX leave days (a request can span several days) ────────────────────
    const nexDays = new Map();
    const empById = new Map(employees.map(e => [e.id, e]));
    for (const q of requests) {
      const emp = empById.get(q.employeeId);
      if (!emp) continue;
      for (let d = new Date(ymd(q.startDate)); d <= new Date(ymd(q.endDate)); d.setUTCDate(d.getUTCDate() + 1)) {
        const date = ymd(d);
        if (!date.startsWith(String(YEAR))) continue;
        const key = `${emp.id}|${date}`;
        const prev = nexDays.get(key);
        if (prev && prev.status === 'APPROVED') continue;
        nexDays.set(key, {
          emp, date, days: q.isHalfDay ? 0.5 : 1, status: q.status,
          typeName: typeName.get(q.leaveTypeId) || '', typeId: q.leaveTypeId, nexId: q.id,
        });
      }
    }

    // ── records.csv: day by day ─────────────────────────────────────────────
    const recordRows = [];
    for (const key of new Set([...wwDays.keys(), ...nexDays.keys()])) {
      const w = wwDays.get(key); const n = nexDays.get(key);
      const emp = (w || n).emp; const date = (w || n).date;
      const match = w && n ? (w.typeId === n.typeId ? 'BOTH_SAME_TYPE' : 'BOTH_DIFFERENT_TYPE') : w ? 'WORKWAY_ONLY' : 'NEX_ONLY';
      recordRows.push({
        employee: empName(emp), email: emp.user?.email || '', date,
        period: date < CUTOVER ? 'before_cutover' : 'from_cutover',
        match,
        workway_type: w?.typeName || '', workway_status: w?.status || '', workway_days: w?.days ?? '',
        nex_type: n?.typeName || '', nex_status: n?.status || '', nex_days: n?.days ?? '',
        workway_id: w?.wwId || '', nex_request_id: n?.nexId || '',
      });
    }
    recordRows.sort((a, b) => a.employee.localeCompare(b.employee) || a.date.localeCompare(b.date));

    // ── balances.csv: employee x type ───────────────────────────────────────
    const sumDays = (map, empId, typeId, pick) => {
      let s = 0;
      for (const d of map.values()) if (d.emp.id === empId && d.typeId === typeId && d.status === 'APPROVED' && pick(d.date)) s += d.days;
      return s;
    };
    const balByKey = new Map(balances.map(b => [`${b.employeeId}|${b.leaveTypeId}`, b]));
    const balanceRows = [];
    const seen = new Set();

    const addRow = (emp, typeId, typeLabel, quota) => {
      const k = `${emp.id}|${typeId}`;
      if (seen.has(k)) return; seen.add(k);
      const b = balByKey.get(k);
      const wwBefore = typeId ? sumDays(wwDays, emp.id, typeId, d => d < CUTOVER) : 0;
      const wwAfter = typeId ? sumDays(wwDays, emp.id, typeId, d => d >= CUTOVER) : 0;
      const nexAfter = typeId ? sumDays(nexDays, emp.id, typeId, d => d >= CUTOVER) : 0;
      const nexAllocated = b ? b.allocated + (b.carriedOver || 0) : null;
      const nexAvailable = b ? nexAllocated - b.used : null;
      const proposedUsed = wwBefore + nexAfter;
      const proposedAvailable = quota == null ? null : quota - proposedUsed;
      const row = {
        employee: empName(emp), email: emp.user?.email || '', leave_type: typeLabel,
        workway_quota: quota ?? '',
        workway_used_before_cutover: round(wwBefore),
        workway_used_from_cutover: round(wwAfter),
        nex_allocated: nexAllocated ?? '', nex_used: b ? round(b.used) : '', nex_available: nexAvailable == null ? '' : round(nexAvailable),
        nex_used_from_cutover: round(nexAfter),
        proposed_used: round(proposedUsed),
        proposed_available: proposedAvailable == null ? '' : round(proposedAvailable),
        change_vs_nex: proposedAvailable == null || nexAvailable == null ? '' : round(proposedAvailable - nexAvailable),
        flag: '',
      };
      const flags = [];
      if (!typeId) flags.push('TYPE_NOT_IN_NEX');
      if (!b) flags.push('NO_NEX_BALANCE_ROW');
      if (proposedAvailable != null && proposedAvailable < 0 && !/unpaid|loss of pay/i.test(typeLabel)) flags.push('NEGATIVE');
      if (wwAfter > 0) flags.push('WORKWAY_LEAVE_AFTER_CUTOVER');
      if (row.change_vs_nex !== '' && row.change_vs_nex !== 0) flags.push('DIFFERS');
      row.flag = flags.join(' ');
      if (flags.includes('NEGATIVE')) issue('NEGATIVE_BALANCE', `${row.employee} – ${typeLabel}: ${row.proposed_available}`, { email: row.email });
      balanceRows.push(row);
    };

    for (const q of wwQuotas) {
      const emp = empByEmail.get(String(q.email).toLowerCase());
      if (!emp) { missingEmails.add(q.email); continue; }
      const type = matchType(q.leave_type);
      if (!type) missingTypes.add(q.leave_type);
      addRow(emp, type?.id ?? null, q.leave_type, Number(q.no_of_leaves) || 0);
    }
    // NEX balances Workway has no quota for, so nothing is silently skipped.
    for (const b of balances) {
      const emp = empById.get(b.employeeId);
      if (emp) addRow(emp, b.leaveTypeId, typeName.get(b.leaveTypeId) || `#${b.leaveTypeId}`, null);
    }
    balanceRows.sort((a, b) => a.employee.localeCompare(b.employee) || a.leave_type.localeCompare(b.leave_type));

    for (const e of missingEmails) issue('EMPLOYEE_NOT_IN_NEX', e);
    for (const t of missingTypes) issue('LEAVE_TYPE_NOT_IN_NEX', t);
    for (const r of recordRows) {
      if (r.match === 'BOTH_DIFFERENT_TYPE') issue('SAME_DAY_DIFFERENT_TYPE', `${r.employee} ${r.date}: Workway ${r.workway_type} / NEX ${r.nex_type}`, { email: r.email });
      if (r.match === 'WORKWAY_ONLY' && r.period === 'from_cutover' && r.workway_status === 'APPROVED') issue('WORKWAY_ONLY_AFTER_CUTOVER', `${r.employee} ${r.date} ${r.workway_type}`, { email: r.email });
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    writeCsv(path.join(OUT_DIR, 'balances.csv'), balanceRows);
    writeCsv(path.join(OUT_DIR, 'records.csv'), recordRows);
    writeCsv(path.join(OUT_DIR, 'issues.csv'), issues.map(i => ({ email: '', ...i })));

    const count = (rows, f) => rows.filter(f).length;
    console.log(`Cutover ${CUTOVER}, year ${YEAR}, company ${COMPANY_ID} — nothing was written to the database.\n`);
    console.log(`Leave days: ${recordRows.length}`);
    for (const m of ['BOTH_SAME_TYPE', 'BOTH_DIFFERENT_TYPE', 'WORKWAY_ONLY', 'NEX_ONLY']) console.log(`  ${m.padEnd(20)} ${count(recordRows, r => r.match === m)}`);
    console.log(`\nBalances (employee x type): ${balanceRows.length}`);
    console.log(`  differ from NEX today   ${count(balanceRows, r => r.flag.includes('DIFFERS'))}`);
    console.log(`  would go negative       ${count(balanceRows, r => r.flag.includes('NEGATIVE'))}`);
    console.log(`  no NEX balance row      ${count(balanceRows, r => r.flag.includes('NO_NEX_BALANCE_ROW'))}`);
    console.log(`\nIssues: ${issues.length}  (employees not in NEX: ${missingEmails.size}, leave types not in NEX: ${missingTypes.size})`);
    console.log(`\nReports: ${OUT_DIR}/{balances,records,issues}.csv`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
