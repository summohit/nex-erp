/**
 * Remove the 13 automatic comp-off credits that the 15 Oct 2026 rule would not
 * have given (see scripts/report-compoff-2026-10.js), and take each day back
 * off the person's comp-off balance.
 *
 *   node scripts/remove-wrong-compoff-2026-10.js            # dry run, writes nothing
 *   node scripts/remove-wrong-compoff-2026-10.js --apply    # writes
 *
 * Only these credit ids, and only while each is still an automatic
 * (ATTENDANCE_DAY_OFF) credit with no approved field visit that day. Someone
 * who has already used the comp-off would go below zero: they are listed and
 * skipped unless --allow-negative is passed. Each person is one transaction.
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const APPLY = process.argv.includes('--apply');
const ALLOW_NEGATIVE = process.argv.includes('--allow-negative');
// #2 Nabin, #9 Ayushman, #10 Gaurav, #14 Ansh kept: the user confirmed they were on
// field visits that day, though the system has no approved visit for them.
const IDS = [3, 4, 5, 6, 7, 8, 11, 12, 13];

const name = (e) => `${e.firstName} ${e.lastName || ''}`.trim();
const ymd = (d) => d.toISOString().slice(0, 10);

(async () => {
  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  const credits = await prisma.compOffCredit.findMany({
    where: { id: { in: IDS } },
    select: {
      id: true, date: true, days: true, year: true, reason: true, employeeId: true, leaveTypeId: true,
      employee: { select: { firstName: true, lastName: true } },
    },
  });

  const byPerson = new Map();
  for (const c of credits) {
    if (c.reason !== 'ATTENDANCE_DAY_OFF' || !c.date) { console.log(`  SKIP credit #${c.id}: no longer an automatic credit`); continue; }
    const onVisit = await prisma.fieldVisitAttendance.findFirst({
      where: { employeeId: c.employeeId, visitDate: c.date, request: { status: { in: ['APPROVED', 'COMPLETED'] } } },
      select: { id: true },
    });
    if (onVisit) { console.log(`  SKIP credit #${c.id}: an approved field visit now covers ${ymd(c.date)}`); continue; }
    const key = `${c.employeeId}:${c.leaveTypeId}:${c.year}`;
    byPerson.set(key, [...(byPerson.get(key) ?? []), c]);
  }
  const missing = IDS.filter((id) => !credits.some((c) => c.id === id));
  if (missing.length) console.log(`  Already gone: credit #${missing.join(', #')}`);

  let removed = 0, skipped = 0;
  for (const [key, list] of byPerson) {
    const [employeeId, leaveTypeId, year] = key.split(':').map(Number);
    const days = list.reduce((s, c) => s + c.days, 0);
    const bal = await prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
      select: { id: true, allocated: true, used: true },
    });
    const after = (bal?.allocated ?? 0) - days;
    const negative = !!bal && after < bal.used;
    const who = name(list[0].employee);
    console.log(`  ${negative ? 'HOLD' : 'FIX '}  ${who} (#${employeeId}) — remove ${days} day(s) [${list.map((c) => `#${c.id} ${ymd(c.date)}`).join(', ')}]`);
    console.log(`         comp-off ${year}: allotted ${bal?.allocated ?? 0} → ${after}, used ${bal?.used ?? 0}, left ${(bal?.allocated ?? 0) - (bal?.used ?? 0)} → ${after - (bal?.used ?? 0)}`);
    if (negative && !ALLOW_NEGATIVE) { console.log('         already used: left alone (pass --allow-negative to remove anyway)'); skipped += list.length; continue; }
    if (!APPLY) { removed += list.length; continue; }

    await prisma.$transaction(async (tx) => {
      const gone = await tx.compOffCredit.deleteMany({ where: { id: { in: list.map((c) => c.id) }, reason: 'ATTENDANCE_DAY_OFF' } });
      if (gone.count !== list.length) throw new Error(`credits for ${who} changed while this ran`);
      if (bal) await tx.leaveBalance.update({ where: { id: bal.id }, data: { allocated: { decrement: days } } });
    });
    removed += list.length;
  }

  console.log(`\n${APPLY ? 'Removed' : 'Would remove'} ${removed} credit(s); held back ${skipped}.`);
  if (!APPLY) console.log('Re-run with --apply to write.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
