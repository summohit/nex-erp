/**
 * Imports a month of Workway attendance into NEX.
 *
 * NEX's September 2026 attendance stops being believable after the 6th: about
 * 45 people show ABSENT every working day, with one to eleven clock-ins across
 * the whole company. Workway kept recording. This brings that record across.
 *
 *   node scripts/import-workway-attendance.js --file <path> --from 2026-09-01 --to 2026-09-21 --dry-run
 *   node scripts/import-workway-attendance.js --file <path> --from 2026-09-01 --to 2026-09-21
 *
 * Input is the per-employee JSON that scraper/workway_attendance.py writes:
 *   [{ workway_id, name, email, records: [{ date, status, clock_in, clock_out, punches }] }]
 *
 * Attendance is unique on (employeeId, date), so this upserts and is safe to
 * re-run. It only writes days inside --from/--to: the range is the instruction,
 * not a filter applied afterwards, so a wider export cannot quietly rewrite
 * months nobody asked about.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const DRY = args.includes('--dry-run');
const FILE = val('--file');
const FROM = val('--from');
const TO = val('--to');
const COMPANY_ID = Number(val('--company')) || 1;

/** Workway's grid icons -> NEX status, plus the flags NEX keeps separately. */
const STATUS = {
  PRESENT:  { status: 'PRESENT' },
  LATE:     { status: 'PRESENT', isLate: true },   // NEX records lateness as a flag, not a status
  HALF_DAY: { status: 'HALF_DAY' },
  ABSENT:   { status: 'ABSENT' },
  DAY_OFF:  { status: 'WEEKLY_OFF' },
  HOLIDAY:  { status: 'HOLIDAY' },
  ON_LEAVE: { status: 'ON_LEAVE' },
};

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** "09:14 AM" on a given date, in IST, stored as the UTC instant it happened. */
function at(dateStr, timeStr) {
  if (!timeStr) return null;
  const m = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(String(timeStr).trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  // The company runs on IST; Workway renders local wall-clock time.
  return new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000+05:30`);
}

async function main() {
  if (!FILE || !FROM || !TO) {
    console.log('usage: --file <json> --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]');
    return;
  }
  const people = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  console.log(`${DRY ? 'DRY RUN\n' : ''}source: ${path.basename(FILE)}  (${people.length} employees)`);
  console.log(`window: ${FROM} .. ${TO}\n`);

  const employees = await prisma.employee.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } },
  });
  const byEmail = new Map(employees.filter((e) => e.user?.email).map((e) => [e.user.email.toLowerCase(), e.id]));
  const byName = new Map(employees.map((e) => [norm(`${e.firstName} ${e.lastName}`), e.id]));

  /**
   * Workway's grid puts the designation after the name in the same cell, so
   * "Ashish Sharma" arrives as "Ashish Sharma Technical Project Manager".
   * Exact name matching misses those, and personal Gmail addresses in Workway
   * mean email does not always catch them either -- Ashish is ashishs@ces-pl.com
   * in NEX and ashishsharma3316@gmail.com in Workway.
   *
   * So: fall back to the longest NEX name that the Workway string starts with.
   * Longest wins, or "Ashish Kumar Mandal" could be claimed by an "Ashish
   * Kumar" if one existed.
   */
  const nameKeys = [...byName.keys()].sort((a, b) => b.length - a.length);
  const byPrefix = (workwayName) => {
    const n = norm(workwayName);
    const hit = nameKeys.find((k) => k.length >= 8 && n.startsWith(k));
    return hit ? byName.get(hit) : null;
  };

  const unmatched = new Set();
  const rows = [];
  for (const p of people) {
    // Email first: two people can share a name, and Workway's own id means
    // nothing here.
    const id = (p.email && byEmail.get(String(p.email).toLowerCase()))
      ?? byName.get(norm(p.name))
      ?? byPrefix(p.name);
    if (!id) { unmatched.add(p.name || p.email || String(p.workway_id)); continue; }
    for (const r of p.records || []) {
      if (!r.date || r.date < FROM || r.date > TO) continue;
      const map = STATUS[r.status];
      if (!map) continue;
      rows.push({
        employeeId: id,
        date: new Date(`${r.date}T00:00:00.000Z`),
        clockIn: at(r.date, r.clock_in),
        clockOut: at(r.date, r.clock_out),
        status: map.status,
        isLate: !!map.isLate,
      });
    }
  }

  console.log(`employees matched   : ${people.length - unmatched.size}/${people.length}`);
  if (unmatched.size) console.log(`  unmatched: ${[...unmatched].join(', ')}`);
  console.log(`day records in range: ${rows.length}`);
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log(`  ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join('   ')}`);
  console.log(`  with a clock-in   : ${rows.filter((r) => r.clockIn).length}`);

  // What this would change, before it changes it.
  const existing = await prisma.attendance.findMany({
    where: { date: { gte: new Date(`${FROM}T00:00:00.000Z`), lte: new Date(`${TO}T00:00:00.000Z`) },
             employee: { companyId: COMPANY_ID } },
    select: { employeeId: true, date: true, status: true, clockIn: true },
  });
  const cur = new Map(existing.map((e) => [`${e.employeeId}:${e.date.toISOString().slice(0, 10)}`, e]));
  const existingByKey = cur;
  let changed = 0, gainClock = 0, statusFlips = 0, wouldErase = 0;
  for (const r of rows) {
    const k = `${r.employeeId}:${r.date.toISOString().slice(0, 10)}`;
    const c = cur.get(k);
    if (!c) { changed++; continue; }
    // The check this script did not have the first time it ran. It counted
    // clock-ins gained and never clock-ins destroyed, so it reported a clean
    // run while nulling eleven real clock-ins that people had recorded in NEX
    // and Workway never knew about.
    // A preview has to model the same rule the write does, or it reports
    // changes that will not happen -- which is how the first run looked safe.
    const keepsNexStatus = r.status === 'ABSENT' && !r.clockIn && c.clockIn;
    if (c.clockIn && !r.clockIn) wouldErase++;
    if (c.status !== r.status && !keepsNexStatus) { statusFlips++; changed++; continue; }
    if (!c.clockIn && r.clockIn) { gainClock++; changed++; }
  }
  console.log(`\nexisting NEX rows in window: ${existing.length}`);
  console.log(`  would change              : ${changed}`);
  console.log(`  status corrections        : ${statusFlips}`);
  console.log(`  gain a clock-in they lack : ${gainClock}`);
  console.log(`  NEX clock-in Workway lacks: ${wouldErase}  (preserved, never overwritten)`);

  if (DRY) return;

  let n = 0;
  for (const r of rows) {
    await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: r.employeeId, date: r.date } },
      create: r,
      // Deliberately partial: NEX-side fields this import knows nothing about
      // -- geolocation, shift, project, clock-out reason -- are left alone.
      //
      // A time is only ever written, never cleared. People clock in through
      // NEX as well as Workway, so "Workway has no time" does not mean "no
      // time happened" -- and writing null here erased eleven real days before
      // this guard existed. Same for status: a day with a clock-in is not
      // absent, whatever the export says.
      update: {
        isLate: r.isLate,
        ...(r.clockIn ? { clockIn: r.clockIn } : {}),
        ...(r.clockOut ? { clockOut: r.clockOut } : {}),
        ...(r.status === 'ABSENT' && !r.clockIn && existingByKey.get(`${r.employeeId}:${r.date.toISOString().slice(0,10)}`)?.clockIn
              ? {}                                   // keep whatever NEX says; they were here
              : { status: r.status }),
      },
    });
    n++;
  }
  console.log(`\nupserted ${n} attendance rows`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
      .finally(() => prisma.$disconnect());
