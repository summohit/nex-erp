/**
 * Shifts for the people who work weekends with a weekday off, so every week
 * knows their rest day even when nobody fills in the roster (decided 15 Oct
 * 2026). Copies General Shift's hours and rules; only the working days differ.
 *
 *   node scripts/setup-weekend-shifts-2026-10.js            # dry run
 *   node scripts/setup-weekend-shifts-2026-10.js --apply
 *
 * Creates (if missing) "General Shift – Monday Off" and "General Shift –
 * Tuesday Off" and moves each person below onto theirs. Roster rows still
 * override single days. Re-running is safe.
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });
const APPLY = process.argv.includes('--apply');

const TEMPLATE_ID = 1; // General Shift
const SHIFTS = [
  { name: 'General Shift – Monday Off', shortCode: 'GM', workingDays: 'Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday', people: [32, 8, 7] },
  { name: 'General Shift – Tuesday Off', shortCode: 'GT', workingDays: 'Monday,Wednesday,Thursday,Friday,Saturday,Sunday', people: [34] },
];

(async () => {
  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  const t = await prisma.shift.findUnique({ where: { id: TEMPLATE_ID } });
  if (!t) throw new Error('General Shift (id 1) not found');
  console.log(`Copying from "${t.name}": ${t.startTime}–${t.endTime}, buffer ${t.bufferTimeMinutes} min, geofence ${t.officeGeofence ? 'on' : 'off'}\n`);

  for (const s of SHIFTS) {
    let shift = await prisma.shift.findFirst({ where: { companyId: t.companyId, name: s.name } });
    console.log(`${shift ? 'EXISTS' : 'CREATE'}  "${s.name}" — works ${s.workingDays}`);
    if (!shift && APPLY) {
      const { id, createdAt, updatedAt, name, shortCode, workingDays, ...rest } = t;
      shift = await prisma.shift.create({ data: { ...rest, name: s.name, shortCode: s.shortCode, workingDays: s.workingDays } });
    }
    const people = await prisma.employee.findMany({
      where: { id: { in: s.people } },
      select: { id: true, firstName: true, lastName: true, shift: { select: { name: true } } },
    });
    for (const p of people) {
      const already = shift && p.shift?.name === s.name;
      console.log(`   ${already ? 'ok  ' : 'MOVE'}  ${p.firstName} ${p.lastName || ''} (#${p.id}): ${p.shift?.name ?? 'no shift'} → ${s.name}`);
      if (!already && APPLY && shift) await prisma.employee.update({ where: { id: p.id }, data: { shiftId: shift.id } });
    }
  }
  console.log(APPLY ? '\nDone.' : '\nRe-run with --apply to write.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
