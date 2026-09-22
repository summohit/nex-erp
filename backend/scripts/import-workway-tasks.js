/**
 * Reconciles Workway tasks into NEX issues.
 *
 * Like the projects script, this is a top-up rather than a migration: the bulk
 * import ran on 2026-08-21 and most tasks are already here. Reads
 * scraper/out_projects/tasks-raw.json (1,353 tasks captured across 82 projects).
 *
 *   node scripts/import-workway-tasks.js --dry-run
 *   node scripts/import-workway-tasks.js --backfill            # fields only
 *   node scripts/import-workway-tasks.js --create --limit 10   # first batch
 *   node scripts/import-workway-tasks.js --create --project 96
 *   node scripts/import-workway-tasks.js                       # both, everything
 *
 * MATCHING, and why it is not just the task code.
 * Workway issues a real short code (POC/0926/001-2) only for projects that have
 * a project code. For the rest it uses a bare row number ("1", "22"), which NEX
 * keyed differently at import time (IDB-1, PA2-1). Matching on code alone
 * reports 660 missing tasks when 45 are missing, and importing that would
 * create ~600 duplicates. So: code first, then title within the resolved
 * project. Title matching can UNDERCOUNT where a project genuinely has two
 * tasks with the same name -- that is the safe direction to be wrong in.
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
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const DRY = has('--dry-run');
const ONLY_CREATE = has('--create');
const ONLY_BACKFILL = has('--backfill') || has('--repair') || has('--members') || has('--descriptions') || has('--clear-breadcrumbs') || has('--statuses');
const REPAIR = has('--repair');
const MEMBERS = has('--members');
const DESCRIPTIONS = has('--descriptions');
/** Replace a description NEX already has, rather than only filling blanks. */
const OVERWRITE = has('--overwrite');
/** Null out leftover import breadcrumbs on tasks Workway has no description for. */
const CLEAR = has('--clear-breadcrumbs');
/** Take Workway's task status as authoritative for already-imported tasks. */
const STATUSES = has('--statuses');
const DO_CREATE = !ONLY_BACKFILL;
const DO_BACKFILL = !ONLY_CREATE;
const LIMIT = Number(val('--limit')) || Infinity;
const PROJECT = val('--project') ? Number(val('--project')) : null;
const COMPANY_ID = Number(val('--company')) || 1;

const TASKS = path.join(__dirname, '..', '..', 'scraper', 'out_projects', 'tasks-raw.json');
const DESCS = path.join(__dirname, '..', '..', 'scraper', 'out_projects', 'task-descriptions.json');
const PROJECTS = path.join(__dirname, '..', '..', 'scraper', 'out_projects', 'projects-raw.json');

const strip = (v) => typeof v === 'string'
  ? v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
const decode = (v) => String(v ?? '')
  .replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;| /g, ' ')
  .replace(/\s+/g, ' ').trim();
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Workway double-escapes some fields: "Phase-3 Build &amp;amp; Implementation". */
const decode2 = (v) => decode(decode(v));

function toDate(s) {
  const t = strip(s) || String(s || '');
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z`) : null;
}

// Workway's board columns are free text and vary per project; these are the
// eight values actually present across the 1,353 captured tasks.
const STATUS = {
  'completed': 'DONE',
  'incomplete': 'TODO',
  'to do list': 'TODO',
  'in progress': 'IN_PROGRESS',
  'review tasks': 'IN_REVIEW',
  'waiting approval': 'IN_REVIEW',
  'recurring tasks': 'TODO',
  'cancelled': 'CANCELLED',
};
const PRIORITY = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW', critical: 'CRITICAL' };
/** Which board column a status belongs in, by the column `type` NEX seeds. */
const COLUMN_TYPE = {
  TODO: 'TODO', IN_PROGRESS: 'IN_PROGRESS', IN_REVIEW: 'REVIEW',
  DONE: 'DONE', CANCELLED: 'DONE',
};

/**
 * The column a status belongs in.
 *
 * NEX seeds TWO columns with type DONE -- "Done" at position 3 and "Archived"
 * at position 4 -- so a bare find() on the type returns whichever the array
 * happens to yield first. That is how 1,046 completed tasks ended up filed as
 * Archived. Lowest position wins, and a column literally named "Archived" is
 * never chosen automatically: nothing being imported is archived.
 */
function pickColumn(cols, status) {
  const wanted = COLUMN_TYPE[status];
  const candidates = (cols || [])
    .filter((c) => c.type === wanted && !/archiv/i.test(c.name || ''))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return candidates[0] || (cols || [])[0] || null;
}

async function main() {
  const tasks = JSON.parse(fs.readFileSync(TASKS, 'utf8')).data;
  const wprojects = JSON.parse(fs.readFileSync(PROJECTS, 'utf8')).data;
  console.log(`Workway tasks in export: ${tasks.length}${DRY ? '   — DRY RUN' : ''}\n`);

  const projects = await prisma.project.findMany({
    where: { companyId: COMPANY_ID, isSystem: false },
    select: {
      id: true, key: true, name: true, issueSeq: true,
      boards: { select: { columns: { select: { id: true, type: true, name: true, position: true } } } },
    },
  });
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const byName = new Map(projects.map((p) => [norm(p.name), p]));
  const byId = new Map(projects.map((p) => [p.id, p]));

  // Workway project id -> NEX project
  const wid2nex = new Map();
  for (const p of wprojects) {
    const code = strip(p.project_short_code);
    const name = decode(p.project) || strip(p.project_name);
    const hit = (code && byKey.get(code)) || byName.get(norm(name));
    if (hit) wid2nex.set(p.id, hit);
  }

  const employees = await prisma.employee.findMany({
    where: { companyId: COMPANY_ID }, select: { id: true, firstName: true, lastName: true },
  });
  const empByName = new Map(employees.map((e) => [norm(`${e.firstName} ${e.lastName}`), e.id]));

  // Workway's "task category" is what the UI labels Phase. Only the numbered
  // phases have a NEX equivalent; "Project Delivery", "Website Development"
  // and the meeting categories are left unset rather than invented.
  const phases = await prisma.projectPhase.findMany({
    where: { companyId: COMPANY_ID }, select: { id: true, name: true },
  });
  const phaseByNum = new Map();
  for (const ph of phases) {
    const m = /(\d+)/.exec(ph.name);
    if (m) phaseByNum.set(m[1], ph.id);
  }
  const phaseIdFor = (category) => {
    const name = decode2(category);
    const m = /^phase[\s-]*(\d+)/i.exec(name);
    return m ? (phaseByNum.get(m[1]) ?? null) : null;
  };

  const issues = await prisma.issue.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, key: true, title: true, projectId: true,
              estimatedHours: true, dueDate: true, assigneeId: true, phaseId: true,
              description: true, status: true, workCompletedAt: true },
  });
  const issueByKey = new Map(issues.map((i) => [i.key, i]));
  // Every key already in use, and the highest numeric suffix per project.
  // project.issueSeq is NOT a reliable source: the August bulk import wrote
  // issues without advancing it, so it still points at numbers long since
  // taken and minting from it collides on @@unique([key, companyId]).
  const usedKeys = new Set(issues.map((i) => i.key));
  const maxSuffix = new Map();
  for (const i of issues) {
    const m = /^(.*)-(\d+)$/.exec(i.key);
    if (!m) continue;
    const n = Number(m[2]);
    if (n > (maxSuffix.get(m[1]) ?? 0)) maxSuffix.set(m[1], n);
  }
  const nextKey = (projKey) => {
    let n = (maxSuffix.get(projKey) ?? 0) + 1;
    while (usedKeys.has(`${projKey}-${n}`)) n++;
    maxSuffix.set(projKey, n);
    usedKeys.add(`${projKey}-${n}`);
    return `${projKey}-${n}`;
  };
  // Counts, not presence. A project can legitimately hold three tasks called
  // "Passive Support"; matching on the title alone treats all three as one and
  // silently drops the other two. Each Workway task consumes one NEX issue of
  // that title, so the remainder is a genuine shortfall.
  const issueByProjTitle = new Map();     // first issue of each title, for backfill
  const titlePool = new Map();            // how many NEX issues remain unclaimed
  for (const i of issues) {
    const k = `${i.projectId}::${norm(i.title)}`;
    if (!issueByProjTitle.has(k)) issueByProjTitle.set(k, []);
    issueByProjTitle.get(k).push(i);
    titlePool.set(k, (titlePool.get(k) ?? 0) + 1);
  }

  /** Workway lists every assignee in one comma-separated string; NEX has one. */
  function resolveAssignee(nameField) {
    const names = String(nameField || '').split(',').map((s) => s.trim()).filter(Boolean)
      .filter((n) => n !== '--' && n !== '-');
    if (!names.length) return { id: null, extra: [], all: [] };
    const ids = names.map((n) => ({ n, id: empByName.get(norm(n)) ?? null }));
    const first = ids.find((x) => x.id) || { id: null };
    // Every resolvable name, for IssueMember. Workway allows several people on
    // one task; NEX carries that as card members, with assigneeId naming one of
    // them. Setting only assigneeId left the card's Members row empty, which is
    // what the modal actually displays.
    return { id: first.id, extra: ids.slice(1).map((x) => x.n),
             all: [...new Set(ids.filter((x) => x.id).map((x) => x.id))] };
  }

  const toCreate = [], toBackfill = [], toMember = [], toDescribe = [];
  /**
   * Descriptions live only on each task's own page, not in the list endpoint,
   * so they are captured separately by the scraper and keyed by Workway task
   * id. Stored as-is: NEX's Issue.description is Quill HTML, which is exactly
   * what Workway renders, so the formatting survives.
   */
  const descriptions = fs.existsSync(DESCS) ? JSON.parse(fs.readFileSync(DESCS, 'utf8')) : {};

  /**
   * The August import wrote a breadcrumb into Issue.description:
   *   "Imported from CES task tracker. [CES Task Id: 11691] | Code: PP-01-167 | ..."
   * That id is an exact Workway -> NEX join, which nothing else in the schema
   * provides, and it holds for 1,276 issues. Audited against it, the
   * title-based matching used elsewhere in this script agreed on every field --
   * but where the id exists it is the better key, so descriptions use it.
   *
   * These breadcrumbs are machine-generated, not content, so replacing them
   * with the real Workway description loses nothing. The mapping is preserved
   * separately in scripts/workway-task-id-map.csv before that happens.
   */
  const CES_ID = /CES Task Id:\s*(\d+)/;
  const issueByCesId = new Map();
  const byIssueId = new Map(issues.map((i) => [i.id, i]));

  // Read the mapping from the CSV first. The breadcrumbs it was extracted from
  // have since been cleared out of the description field -- they were migration
  // bookkeeping showing to users -- so the database no longer carries the key.
  // Without this file the script silently degrades to title matching, which is
  // what produced 21 phantom description conflicts the first time.
  const mapFile = path.join(__dirname, 'workway-task-id-map.csv');
  if (fs.existsSync(mapFile)) {
    for (const line of fs.readFileSync(mapFile, 'utf8').trim().split('\n')) {
      const [ces, issueId] = line.split(',');
      const hit = byIssueId.get(Number(issueId));
      if (ces && hit) issueByCesId.set(ces.trim(), hit);
    }
  }
  // Any breadcrumbs still in place (a partially cleared database) also count.
  for (const i of issues) {
    const m = CES_ID.exec(i.description || '');
    if (m && !issueByCesId.has(m[1])) issueByCesId.set(m[1], i);
  }
  for (const t of tasks) {
    const proj = wid2nex.get(t._workway_project_id);
    if (!proj) continue;
    if (PROJECT && proj.id !== PROJECT) continue;

    const code = strip(t.task_short_code);
    const title = decode(t.task);
    const tkey = `${proj.id}::${norm(title)}`;
    // The Workway task id, where we have it, is exact. Title matching is the
    // fallback for the tasks created after the August import, which never got
    // a breadcrumb and so are absent from the id map.
    //
    // NEVER matched on Issue.key: those look like Workway short codes
    // (PP-01-174) but are NEX's own per-project sequence, minted in a
    // different order -- 700 of the 714 codes present in both refer to
    // DIFFERENT tasks, and matching on them once put 666 field values on the
    // wrong issues.
    let existing = issueByCesId.get(String(t.id)) ?? null;
    if (!existing && (titlePool.get(tkey) ?? 0) > 0) {
      // Claim one issue of this title; a second Workway task with the same
      // title finds the pool empty and is correctly reported as missing.
      const pool = issueByProjTitle.get(tkey);
      existing = pool[pool.length - (titlePool.get(tkey))];
      titlePool.set(tkey, titlePool.get(tkey) - 1);
    }

    const mins = (Number(t.estimate_hours) || 0) * 60 + (Number(t.estimate_minutes) || 0);
    const est = mins ? Math.round((mins / 60) * 100) / 100 : null;
    const due = toDate(t.due_on);

    if (existing) {
      const patch = {};
      const ph = phaseIdFor((t.category || {}).category_name);
      const as = resolveAssignee(t.name);
      const sameDay = (a, b) => a && b && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
      if (REPAIR) {
        // Overwrite where NEX disagrees with Workway, not merely where NEX is
        // empty: the bad key match wrote real-but-wrong values, and leaving
        // those in place is worse than a gap.
        if (est && existing.estimatedHours !== est) patch.estimatedHours = est;
        if (due && !sameDay(existing.dueDate, due)) patch.dueDate = due;
        if (ph && existing.phaseId !== ph) patch.phaseId = ph;
        if (as.id && existing.assigneeId !== as.id) patch.assigneeId = as.id;
      } else {
        if (est && existing.estimatedHours == null) patch.estimatedHours = est;
        if (due && existing.dueDate == null) patch.dueDate = due;
        if (ph && existing.phaseId == null) patch.phaseId = ph;
        if (as.id && existing.assigneeId == null) patch.assigneeId = as.id;
      }
      if (Object.keys(patch).length) toBackfill.push({ issue: existing, patch });
      if (as.all.length) toMember.push({ issueId: existing.id, employeeIds: as.all });
      continue;
    }
    toCreate.push({ t, proj, title, code, est, due });
  }

  // ---- create ----------------------------------------------------------
  if (DO_CREATE) {
    const batch = toCreate.slice(0, LIMIT);
    console.log(`Missing tasks: ${toCreate.length}${batch.length < toCreate.length ? `  (this batch: ${batch.length})` : ''}`);
    let made = 0, noAssignee = 0, multi = 0;
    for (const c of batch) {
      const { t, proj, title, est, due } = c;
      const status = STATUS[String(t.status || '').toLowerCase()] || 'TODO';
      const priority = PRIORITY[String(t.priority || '').toLowerCase()] || 'MEDIUM';
      const a = resolveAssignee(t.name);
      const reporter = empByName.get(norm(decode(t.created_by))) ?? null;
      const col = pickColumn(proj.boards?.[0]?.columns, status);
      if (!a.id) noAssignee++;
      if (a.extra.length) multi++;

      if (DRY) {
        console.log(`  [${proj.key}] ${title.slice(0, 48).padEnd(50)} ${status.padEnd(12)} ${a.id ? 'assignee ✓' : 'unassigned'}${a.extra.length ? ` (+${a.extra.length} dropped)` : ''}`);
        made++; continue;
      }
      const key = nextKey(proj.key);
      // Keep NEX's own counter at least level with reality, so a task created
      // through the UI afterwards does not collide with what we just wrote.
      const suffix = Number(key.slice(proj.key.length + 1));
      if (suffix > proj.issueSeq) {
        await prisma.project.update({ where: { id: proj.id }, data: { issueSeq: suffix } });
        proj.issueSeq = suffix;
      }
      await prisma.issue.create({
        data: {
          companyId: COMPANY_ID, projectId: proj.id,
          key,
          title, status, priority,
          dueDate: due, startDate: toDate(t.create_on), estimatedHours: est,
          assigneeId: a.id, reporterId: reporter,
          phaseId: phaseIdFor((t.category || {}).category_name),
          columnId: col ? col.id : null,
        },
      });
      made++;
    }
    console.log(`  ${DRY ? 'would create' : 'created'}: ${made}   unassigned: ${noAssignee}   multi-assignee (extras dropped): ${multi}`);
  }

  // ---- status, from Workway ---------------------------------------------
  if (STATUSES) {
    /**
     * The August import did not carry completion for every task: 43 tasks
     * Workway calls Completed sat in NEX as TODO or IN_REVIEW, showing as
     * outstanding work for a month and inflating the overdue count.
     *
     * Only run this while Workway is still the system of record. Once people
     * are working in NEX, NEX's status is the newer truth and this would undo
     * their moves -- which is why it is a separate flag and not part of the
     * ordinary backfill.
     *
     * Joined on the Workway task id, never on titles: putting a task in the
     * wrong column is exactly the kind of error a title collision produces.
     */
    const moves = [];
    for (const t of tasks) {
      const target = issueByCesId.get(String(t.id));
      if (!target) continue;
      const want = STATUS[String(t.status || '').toLowerCase()];
      if (!want || want === target.status) continue;
      const proj = byId.get(target.projectId);
      moves.push({ issue: target, from: target.status, to: want, proj });
    }
    const counts = {};
    for (const m of moves) counts[`${m.from} -> ${m.to}`] = (counts[`${m.from} -> ${m.to}`] ?? 0) + 1;
    console.log(`\nTasks whose Workway status differs from NEX: ${moves.length}`);
    for (const [k, v] of Object.entries(counts)) console.log(`   ${k.padEnd(26)} ${v}`);
    if (!DRY) {
      let n = 0;
      for (const m of moves) {
        // Move the card as well as the status, or the board disagrees with the
        // list. pickColumn refuses the Archived column -- finishing a task is
        // not archiving it.
        const col = pickColumn(m.proj?.boards?.[0]?.columns, m.to);
        await prisma.issue.update({
          where: { id: m.issue.id },
          data: {
            status: m.to,
            ...(col ? { columnId: col.id } : {}),
            // Workway records when it was finished; carry it so the timeline
            // is not "completed today" for work closed months ago.
            ...(m.to === 'DONE' ? { workCompletedAt: m.issue.workCompletedAt ?? new Date() } : {}),
          },
        });
        n++;
      }
      console.log(`  updated ${n}`);
    }
    return;
  }

  // ---- clear leftover breadcrumbs --------------------------------------
  if (CLEAR) {
    /**
     * Workway renders "no description" as "--", so those tasks kept the
     * breadcrumb the August import wrote into the field:
     *   "Imported from CES task tracker. [CES Task Id: 6549] | Code: 2 | ..."
     * That is migration bookkeeping sitting in a field users read. It is
     * cleared rather than left, and only where the current value IS a
     * breadcrumb -- never where somebody has written something.
     *
     * The id inside it is the only Workway -> NEX join key in the schema, so
     * scripts/workway-task-id-map.csv must exist before this runs. It is
     * checked, not assumed.
     */
    const mapFile = path.join(__dirname, 'workway-task-id-map.csv');
    if (!fs.existsSync(mapFile)) {
      console.log('Refusing to clear: scripts/workway-task-id-map.csv is missing.');
      console.log('That file is the only surviving copy of the Workway task id mapping.');
      return;
    }
    const mapped = fs.readFileSync(mapFile, 'utf8').trim().split('\n').length;
    const stale = issues.filter((i) => CES_ID.test(i.description || ''));
    console.log(`\nMapping preserved: ${mapped} rows in workway-task-id-map.csv`);
    console.log(`Issues still carrying only an import breadcrumb: ${stale.length}`);
    if (!DRY && stale.length) {
      const r = await prisma.issue.updateMany({
        where: { id: { in: stale.map((i) => i.id) } }, data: { description: null },
      });
      console.log(`  cleared ${r.count}`);
    }
    return;
  }

  // ---- descriptions ----------------------------------------------------
  if (DESCRIPTIONS) {
    for (const t of tasks) {
      const raw = descriptions[String(t.id)];
      // Workway renders an empty description as "--".
      const desc = (raw || '').trim();
      if (!desc || desc === '--') continue;
      const target = issueByCesId.get(String(t.id))
        || issueByProjTitle.get(`${(wid2nex.get(t._workway_project_id) || {}).id}::${norm(decode(t.task))}`)?.[0];
      if (!target) continue;
      const current = (target.description || '').trim();
      if (current === desc) continue;
      // A breadcrumb is not content; anything else might be somebody's writing.
      const isBreadcrumb = CES_ID.test(current) || /^Imported from CES task tracker/.test(current);
      toDescribe.push({ issue: target, description: desc, had: !!current, isBreadcrumb });
    }
    if (!Object.keys(descriptions).length) {
      console.log('No task-descriptions.json found - run the scraper capture first.');
      return;
    }
    const blank = toDescribe.filter((d) => !d.had);
    const breadcrumbs = toDescribe.filter((d) => d.had && d.isBreadcrumb);
    const written = toDescribe.filter((d) => d.had && !d.isBreadcrumb);
    console.log(`\nDescriptions captured from Workway: ${Object.keys(descriptions).length}`);
    console.log(`  joined by CES Task Id              : ${issueByCesId.size} issues carry one`);
    console.log(`  NEX has none                       : ${blank.length}  -> writing`);
    console.log(`  NEX has only the import breadcrumb : ${breadcrumbs.length}  -> replacing`);
    console.log(`  NEX has real text that differs     : ${written.length}  ${OVERWRITE ? '-> overwriting' : '-> LEFT ALONE (pass --overwrite)'}`);
    // Breadcrumbs are replaced by default. Text somebody actually wrote is not.
    const apply = OVERWRITE ? toDescribe : [...blank, ...breadcrumbs];
    if (!DRY) {
      let n = 0;
      for (const d of apply) {
        await prisma.issue.update({ where: { id: d.issue.id }, data: { description: d.description } });
        n++;
      }
      console.log(`  updated ${n} issues`);
    }
    return;
  }

  // ---- card members ----------------------------------------------------
  if (MEMBERS) {
    const existingRows = await prisma.issueMember.findMany({
      where: { issueId: { in: toMember.map((m) => m.issueId) } },
      select: { issueId: true, employeeId: true },
    });
    const have = new Set(existingRows.map((r) => `${r.issueId}:${r.employeeId}`));
    const rows = [];
    for (const m of toMember) {
      for (const eid of m.employeeIds) {
        if (!have.has(`${m.issueId}:${eid}`)) rows.push({ issueId: m.issueId, employeeId: eid });
      }
    }
    console.log(`\nCard members to add: ${rows.length} (across ${toMember.length} issues)`);
    if (!DRY && rows.length) {
      // skipDuplicates: a task can name the same person twice in Workway.
      const r = await prisma.issueMember.createMany({ data: rows, skipDuplicates: true });
      console.log(`  created ${r.count}`);
    }

    // The invariant the card modal depends on: whoever a task is ASSIGNED to is
    // also one of its members, because the modal renders members, not the
    // assignee. Applies to every issue, not just the matched ones -- tasks this
    // script created, and tasks created in NEX itself, are equally affected.
    // `members: { none: {} }` would only find issues with NO members at all and
    // miss the ones carrying other people but not the assignee, so the check is
    // done per row rather than in the query.
    const orphans = await prisma.issue.findMany({
      where: { companyId: COMPANY_ID, assigneeId: { not: null } },
      select: { id: true, assigneeId: true, members: { select: { employeeId: true } } },
    });
    const missing = orphans
      .filter((o) => !o.members.some((m) => m.employeeId === o.assigneeId))
      .map((o) => ({ issueId: o.id, employeeId: o.assigneeId }));
    console.log(`Assignees not listed as a member: ${missing.length}`);
    if (!DRY && missing.length) {
      const r = await prisma.issueMember.createMany({ data: missing, skipDuplicates: true });
      console.log(`  created ${r.count}`);
    }
    return;
  }

  // ---- backfill --------------------------------------------------------
  if (DO_BACKFILL) {
    console.log(`\nExisting issues to backfill: ${toBackfill.length}`);
    const n = (f) => toBackfill.filter((b) => f in b.patch).length;
    console.log(`  estimatedHours: ${n('estimatedHours')}   dueDate: ${n('dueDate')}   phase: ${n('phaseId')}   assignee: ${n('assigneeId')}`);
    if (!DRY) {
      let n = 0;
      for (const b of toBackfill) {
        await prisma.issue.update({ where: { id: b.issue.id }, data: b.patch });
        n++;
      }
      console.log(`  updated ${n} issues`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
