/**
 * Moves completed tasks out of the "Archived" board column.
 *
 * NEX seeds two columns with type DONE -- "Done" (position 3) and "Archived"
 * (position 4). Code that picks a column with cols.find(c => c.type === 'DONE')
 * gets whichever the array yields first, and the August 2026 import got
 * "Archived" -- filing 1,040 completed tasks there. Eight more arrived the same
 * way since.
 *
 * None of them is actually archived: Issue.isArchived is false for every one,
 * because that flag is set by the Archive action, not by the column. So this is
 * purely a wrong-column problem, and moving them is safe.
 *
 *   node scripts/fix-archived-column.js --dry-run
 *   node scripts/fix-archived-column.js
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

async function main() {
  const cols = await prisma.boardColumn.findMany({
    where: { board: { project: { companyId: COMPANY_ID } } },
    select: { id: true, name: true, type: true, position: true, boardId: true },
  });
  const byBoard = new Map();
  for (const c of cols) {
    if (!byBoard.has(c.boardId)) byBoard.set(c.boardId, []);
    byBoard.get(c.boardId).push(c);
  }
  // Per board: the Archived column, and the real Done column to move cards to.
  const move = new Map();
  for (const [boardId, list] of byBoard) {
    const archived = list.find((c) => /archiv/i.test(c.name || ''));
    const done = list
      .filter((c) => c.type === 'DONE' && !/archiv/i.test(c.name || ''))
      .sort((a, b) => a.position - b.position)[0];
    if (archived && done) move.set(archived.id, done);
  }

  const stuck = await prisma.issue.findMany({
    where: {
      companyId: COMPANY_ID,
      columnId: { in: [...move.keys()] },
      status: 'DONE',
      isArchived: false,          // genuinely archived cards stay put
    },
    select: { id: true, key: true, columnId: true },
  });

  console.log(`${DRY ? 'DRY RUN\n' : ''}Completed tasks sitting in an "Archived" column: ${stuck.length}`);
  if (!stuck.length) return;

  const byTarget = new Map();
  for (const i of stuck) {
    const t = move.get(i.columnId);
    byTarget.set(t.id, (byTarget.get(t.id) ?? 0) + 1);
  }
  console.log(`  moving into ${byTarget.size} "Done" columns across the company`);
  if (DRY) return;

  let n = 0;
  for (const [targetId, _] of byTarget) {
    const ids = stuck.filter((i) => move.get(i.columnId).id === targetId).map((i) => i.id);
    const r = await prisma.issue.updateMany({ where: { id: { in: ids } }, data: { columnId: targetId } });
    n += r.count;
  }
  console.log(`  moved ${n}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
      .finally(() => prisma.$disconnect());
