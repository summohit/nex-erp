/**
 * Imports one person's Workway tasks that belong to no project into NEX's
 * hidden General project, so they can see their history (Delivery > Tasks).
 *
 * The August import only covered project tasks (1,353 across 82 projects).
 * Tasks with Project "--" in Workway -- HR to-do lists, onboarding templates --
 * were never brought across. Input is the JSON scraper/workway_tasks.py writes:
 *
 *   node scripts/import-workway-general-tasks.js --file ../scraper/out_hr/tasks-akshara.json --dry-run
 *   node scripts/import-workway-general-tasks.js --file ../scraper/out_hr/tasks-akshara.json
 *
 * What a task keeps: title, description (with its numbering), status,
 * priority, start / due / created / completed dates, assignee and assigner.
 * Workway's comments and history go on as one comment each, so nothing that
 * was written is lost. Task category and hours logged are noted at the end of
 * the description -- NEX has no general-task equivalent for either.
 *
 * Safe to re-run: a task already imported (its Workway id is in the
 * description footer) is skipped. Project tasks in the file are skipped too;
 * they are the August import's job.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const DRY = args.includes('--dry-run');
const FILE = val('--file');
const COMPANY_ID = Number(val('--company')) || 1;

if (!FILE) {
  console.error('Usage: node scripts/import-workway-general-tasks.js --file <tasks.json> [--dry-run]');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const STATUS = {
  'completed': 'DONE', 'in progress': 'IN_PROGRESS', 'incomplete': 'TODO', 'to do list': 'TODO',
  'review tasks': 'IN_REVIEW', 'waiting approval': 'IN_REVIEW', 'cancelled': 'CANCELLED',
};
const PRIORITY = { urgent: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };
/** NEX column type for each status. */
const COLUMN_TYPE = { TODO: 'TODO', IN_PROGRESS: 'IN_PROGRESS', IN_REVIEW: 'REVIEW', DONE: 'DONE', CANCELLED: 'DONE' };

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
const blank = (s) => !s || ['--', '-', '—'].includes(String(s).trim());
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/**
 * The title as Workway shows it on the task page. The list cell it was read
 * from appends the priority and a "Private" badge ("Video Creation Medium
 * Private") and leaves HTML entities ("Event &amp; Celebration").
 */
const cleanTitle = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/\s+\d{1,3}:\d{2}:\d{2}\s*$/, '') // a running timer the cell shows ("34:17:42")
  .replace(/(\s+(Low|Medium|High|Urgent))?(\s+Private)?\s*$/i, '')
  .trim();
const html = (text) => String(text || '').split(/\n+/).filter((l) => l.trim()).map((l) => `<p>${esc(l.trim())}</p>`).join('');

/** "02-08-2026 11:28 pm" or "04-08-2026" (IST) -> Date. */
function toDate(s) {
  const m = String(s || '').match(/(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm))?/i);
  if (!m) return null;
  let [, d, mo, y, h, mi, ap] = m;
  let hour = h ? Number(h) % 12 + (/pm/i.test(ap) ? 12 : 0) : 0;
  return new Date(Date.UTC(+y, +mo - 1, +d, hour, Number(mi || 0)) - 5.5 * 3600000);
}

async function main() {
  const tasks = JSON.parse(fs.readFileSync(path.resolve(FILE), 'utf8'));
  const employees = await prisma.employee.findMany({
    where: { companyId: COMPANY_ID }, select: { id: true, firstName: true, lastName: true },
  });
  /** "Miss Akshara Shukla HR Associate" -> the employee whose full name it contains. */
  const resolve = (label) => {
    const s = ` ${norm(label)} `;
    const hits = employees.filter((e) => s.includes(` ${norm(`${e.firstName} ${e.lastName || ''}`)} `));
    return hits.sort((a, b) => `${b.firstName}${b.lastName}`.length - `${a.firstName}${a.lastName}`.length)[0] ?? null;
  };

  const general = await prisma.project.findFirst({
    where: { companyId: COMPANY_ID, isSystem: true },
    select: { id: true, key: true, boards: { take: 1, select: { columns: { select: { id: true, type: true, name: true, position: true } } } } },
  });
  if (!general) throw new Error('No General project for this company -- create one general task in the app first.');
  const columns = (general.boards[0]?.columns || []).filter((c) => !/archiv/i.test(c.name)).sort((a, b) => a.position - b.position);

  const done = new Set((await prisma.issue.findMany({
    where: { projectId: general.id, description: { contains: 'Imported from Workway task #' } },
    select: { description: true },
  })).map((i) => (i.description.match(/Imported from Workway task #(\d+)/) || [])[1]));

  let made = 0, skipped = 0, unassigned = 0;
  for (const t of tasks) {
    const F = t.fields || {};
    const L = t.list || {};
    if (!blank(F.Project)) { skipped++; console.log(`  skip  #${t.id} has a project (${F.Project})`); continue; }
    if (done.has(String(t.id))) { skipped++; console.log(`  skip  #${t.id} already imported`); continue; }

    const status = STATUS[String(L.board_column || '').toLowerCase()] || 'TODO';
    const priority = PRIORITY[String(F.Priority || L.priority || '').toLowerCase()] || 'MEDIUM';
    const assignee = resolve(F['Assigned To']);
    const reporter = resolve(F['Assigned By']);
    if (!assignee) unassigned++;
    const created = toDate(F['Created On']) || toDate(L.create_on);
    const completed = status === 'DONE' ? toDate(L.completed_on) : null;
    const column = columns.find((c) => c.type === COLUMN_TYPE[status]) || columns[0];

    const footer = [
      !blank(F['Task category']) && `Category: ${F['Task category']}`,
      !blank(F['Hours Logged']) && F['Hours Logged'] !== '0s' && `Hours logged in Workway: ${F['Hours Logged']}`,
      `Imported from Workway task #${t.id}`,
    ].filter(Boolean);
    const description = `${html(t.description)}<p><em>${footer.map(esc).join(' · ')}</em></p>`;

    const title = cleanTitle(t.title);
    const line = `#${String(t.id).padEnd(6)} ${title.slice(0, 44).padEnd(46)} ${status.padEnd(12)} `
      + `${assignee ? `${assignee.firstName} ${assignee.lastName}` : 'UNASSIGNED'}`;
    if (DRY) { console.log(`  would create  ${line}`); made++; continue; }

    await prisma.$transaction(async (tx) => {
      const p = await tx.project.update({ where: { id: general.id }, data: { issueSeq: { increment: 1 } }, select: { issueSeq: true } });
      const issue = await tx.issue.create({
        data: {
          companyId: COMPANY_ID, projectId: general.id, key: `${general.key}-${p.issueSeq}`,
          title, description, status, priority,
          startDate: toDate(F['Start Date'] || L.start_date), dueDate: toDate(F['Due Date'] || L.due_date),
          assigneeId: assignee?.id ?? null, reporterId: reporter?.id ?? null,
          columnId: column?.id ?? null,
          completedAt: completed, workCompletedAt: completed,
          ...(created ? { createdAt: created } : {}),
          ...(assignee ? { members: { create: [{ employeeId: assignee.id }] } } : {}),
        },
      });
      const author = assignee?.id ?? reporter?.id;
      const notes = [['Comments', 'Comments from Workway'], ['History', 'History from Workway'], ['Notes', 'Notes from Workway']];
      for (const [tab, label] of notes) {
        const text = t.tabs?.[tab]?.text;
        if (text && author) {
          await tx.issueComment.create({ data: { issueId: issue.id, authorId: author, body: `<p><strong>${label}</strong></p>${html(text)}` } });
        }
      }
    });
    console.log(`  created       ${line}`);
    made++;
  }
  console.log(`\n${DRY ? 'Would create' : 'Created'}: ${made}   skipped: ${skipped}   unassigned: ${unassigned}`
    + `${DRY ? '\n(dry run -- nothing was written)' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
