/**
 * Splits NEX project 53 back into the two Workway projects it was merged from.
 *
 * Workway holds two projects whose names differ only by spacing:
 *   343  "GDC DC2 Bangalore"   no code,  06-10-2025 -> 21-10-2025, Rs 60,000,  2 tasks
 *   408  "GDC_DC2_Bangalore"   CES/0825/084, 16-09-2025 -> 30-11-2025, Rs 1,30,000, 6 tasks
 *
 * The August import collapsed them into one NEX row, which ended up with 343's
 * dates and 408's budget and code, holding a mix of both task sets -- and lost
 * 408's "Internal Meeting" in the process. Mohit confirmed these are two real
 * projects.
 *
 * Project 53 keeps the code and becomes 408. A new project is created for 343.
 *
 * Which task goes where is decided by due date, not title: both projects have a
 * "Bangalore DC2 as built preparation", and issue 1146 is due 20-12-2025, which
 * is 343's copy (408's is due 09-12-2025).
 *
 *   node scripts/split-gdc-project.js --dry-run
 *   node scripts/split-gdc-project.js
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});
const DRY = process.argv.includes('--dry-run');
const COMPANY_ID = 1;
const KEEP = 53;                       // becomes Workway 408
const MOVE_ISSUES = [1146, 1250];      // Workway 343's two tasks
const d = (s) => new Date(`${s}T00:00:00.000Z`);

async function main() {
  const keep = await prisma.project.findUnique({
    where: { id: KEEP },
    select: { id: true, key: true, name: true, startDate: true, endDate: true,
              members: { select: { employeeId: true, role: true } },
              boards: { select: { columns: { select: { id: true, type: true } } } } },
  });
  if (!keep) throw new Error(`project ${KEEP} not found`);
  console.log(`${DRY ? 'DRY RUN\n' : ''}Keeping ${keep.key} "${keep.name}" as Workway 408`);

  // --- 1. correct the dates project 53 inherited from the wrong project ----
  console.log(`  dates ${keep.startDate?.toISOString().slice(0,10)} -> 2025-09-16, ` +
              `${keep.endDate?.toISOString().slice(0,10)} -> 2025-11-30`);
  // Take Workway's own spelling for this one. Both projects are otherwise
  // called "GDC DC2 Bangalore", and two identically named rows side by side is
  // what produced the merge in the first place.
  console.log(`  name "${keep.name}" -> "GDC_DC2_Bangalore"`);
  if (!DRY) {
    await prisma.project.update({
      where: { id: KEEP },
      data: { startDate: d('2025-09-16'), endDate: d('2025-11-30'), name: 'GDC_DC2_Bangalore' },
    });
  }

  // --- 2. the new project for Workway 343 ---------------------------------
  const taken = new Set((await prisma.project.findMany({
    where: { companyId: COMPANY_ID }, select: { key: true } })).map((p) => p.key));
  const now = new Date();
  const base = `CES/${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(-2)}/`;
  let seq = 1;
  while (taken.has(`${base}${String(seq).padStart(2, '0')}`)) seq++;
  const newKey = `${base}${String(seq).padStart(2, '0')}`;

  console.log(`\nCreating ${newKey} "GDC DC2 Bangalore" (Workway 343)`);
  console.log(`  2025-10-06 -> 2025-10-21, budget 60000, COMPLETED, ${keep.members.length} members`);

  let created = null;
  if (!DRY) {
    created = await prisma.project.create({
      data: {
        companyId: COMPANY_ID, name: 'GDC DC2 Bangalore', key: newKey,
        startDate: d('2025-10-06'), endDate: d('2025-10-21'),
        budgetAmount: 60000, currency: 'INR',
        workStatus: 'COMPLETED', progress: 100,
        // Same three people are on both Workway projects.
        members: { create: keep.members.map((m) => ({ employeeId: m.employeeId, role: m.role })) },
        boards: {
          create: {
            name: 'Main Board',
            columns: { create: [
              { name: 'To Do', color: '#6b7280', position: 0, isSystem: true, type: 'TODO' },
              { name: 'In Progress', color: '#3b82f6', position: 1, isSystem: true, type: 'IN_PROGRESS' },
              { name: 'In Review', color: '#8b5cf6', position: 2, isSystem: true, type: 'REVIEW' },
              { name: 'Done', color: '#22c55e', position: 3, isSystem: true, type: 'DONE' },
              { name: 'Archived', color: '#9ca3af', position: 4, isSystem: true, type: 'DONE' },
            ] },
          },
        },
      },
      select: { id: true, key: true, boards: { select: { columns: { select: { id: true, type: true } } } } },
    });
    console.log(`  created (id ${created.id})`);
  }

  // --- 3. move 343's tasks across -----------------------------------------
  const moving = await prisma.issue.findMany({
    where: { id: { in: MOVE_ISSUES } }, select: { id: true, key: true, title: true },
  });
  console.log(`\nMoving ${moving.length} issues to the new project:`);
  for (const m of moving) console.log(`  ${m.key}  ${m.title}`);
  if (!DRY) {
    const doneCol = created.boards[0].columns.find((c) => c.type === 'DONE');
    let n = 0;
    for (const m of moving) {
      n++;
      await prisma.issue.update({
        where: { id: m.id },
        data: { projectId: created.id, key: `${created.key}-${n}`, columnId: doneCol?.id ?? null },
      });
    }
  }

  // --- 4. the two tasks project 53 is left missing ------------------------
  const missing = [
    { title: 'Bangalore DC2 As built preparation', due: d('2025-12-09'), who: 'Afnan Ali' },
    { title: 'Internal Meeting', due: null, who: 'Karan Virmani' },
  ];
  console.log(`\nAdding ${missing.length} missing tasks to ${keep.key}:`);
  for (const m of missing) console.log(`  ${m.title}${m.due ? `  due ${m.due.toISOString().slice(0,10)}` : ''}  -> ${m.who}`);
  if (!DRY) {
    const emps = await prisma.employee.findMany({
      where: { companyId: COMPANY_ID }, select: { id: true, firstName: true, lastName: true } });
    const byName = new Map(emps.map((e) => [`${e.firstName} ${e.lastName}`.toLowerCase(), e.id]));
    const doneCol = keep.boards[0]?.columns.find((c) => c.type === 'DONE');
    const used = new Set((await prisma.issue.findMany({
      where: { projectId: KEEP }, select: { key: true } })).map((i) => i.key));
    let n = 1;
    for (const m of missing) {
      while (used.has(`${keep.key}-${n}`)) n++;
      used.add(`${keep.key}-${n}`);
      await prisma.issue.create({
        data: {
          companyId: COMPANY_ID, projectId: KEEP, key: `${keep.key}-${n}`,
          title: m.title, status: 'DONE', priority: 'MEDIUM',
          dueDate: m.due, assigneeId: byName.get(m.who.toLowerCase()) ?? null,
          columnId: doneCol?.id ?? null,
        },
      });
    }
    console.log(`  created ${missing.length}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
      .finally(() => prisma.$disconnect());
