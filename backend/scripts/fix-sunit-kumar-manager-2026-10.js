/**
 * Sunit Kumar's manager: Shaila Badar → Arshi Badar.
 *
 * Workway (the old HR tool) has Sunit Kumar reporting to Mrs Arshi Badar,
 * Center manager. MIRA had him under Shaila Badar — a different person with the
 * same surname, most likely picked by mistake when his record was set up.
 * Checked on 15 Oct 2026 with scripts/check-sunit-kumar-team.js; his own team of
 * ten already matched Workway and is not touched.
 *
 *   node scripts/fix-sunit-kumar-manager-2026-10.js            # dry run, writes nothing
 *   node scripts/fix-sunit-kumar-manager-2026-10.js --apply    # writes
 *
 * Changes one field on one row: Employee #32's managerId. Nothing is written if
 * either person is not who this expects, if they are in different companies,
 * or if his manager is no longer Shaila Badar (someone has changed it since).
 * Re-running after it has been applied reports that it is already correct.
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

const SUNIT = { id: 32, code: '20117', name: 'Sunit Kumar' };
const FROM = { id: 48, name: 'Shaila Badar' };
const TO = { id: 8, code: '20111', name: 'Arshi Badar' };

const full = (e) => `${e?.firstName || ''} ${e?.lastName || ''}`.trim();
const stop = (msg) => { console.error(`ERROR: ${msg} — nothing written.`); process.exit(1); };

(async () => {
  const select = { id: true, firstName: true, lastName: true, employeeCode: true, companyId: true, managerId: true };
  const [sunit, to] = await Promise.all([
    prisma.employee.findUnique({ where: { id: SUNIT.id }, select }),
    prisma.employee.findUnique({ where: { id: TO.id }, select }),
  ]);

  if (!sunit || sunit.employeeCode !== SUNIT.code || !/sunit/i.test(full(sunit))) {
    stop(`employee #${SUNIT.id} is not ${SUNIT.name} (code ${SUNIT.code})`);
  }
  if (!to || to.employeeCode !== TO.code || !/arshi/i.test(full(to))) {
    stop(`employee #${TO.id} is not ${TO.name} (code ${TO.code})`);
  }
  if (sunit.companyId !== to.companyId) stop('they are in different companies');

  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);

  if (sunit.managerId === TO.id) {
    console.log(`  NO-OP  ${full(sunit)} already reports to ${full(to)}.`);
    return;
  }
  if (sunit.managerId !== FROM.id) {
    const current = sunit.managerId ? await prisma.employee.findUnique({ where: { id: sunit.managerId }, select }) : null;
    stop(`${full(sunit)} now reports to ${current ? `${full(current)} (#${current.id})` : 'nobody'}, not ${FROM.name} — check by hand`);
  }

  console.log(`  FIX  ${full(sunit)} (#${sunit.id}, code ${sunit.employeeCode})`);
  console.log(`       manager: ${FROM.name} (#${FROM.id})  →  ${full(to)} (#${to.id}, code ${to.employeeCode})`);

  if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

  // Conditional on the old value, so a change made by someone else in between is not overwritten.
  const { count } = await prisma.employee.updateMany({
    where: { id: SUNIT.id, managerId: FROM.id },
    data: { managerId: TO.id },
  });
  if (count !== 1) stop('his manager changed while this was running');
  console.log(`\nDone. ${full(sunit)} now reports to ${full(to)}.`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
