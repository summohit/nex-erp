/**
 * Import CES Tech (Workway) time logs into IssueTimeLog.
 *
 *   npx ts-node import-ces-timelogs.ts --file ../scraper/out_hr/timelogs-01-01-2024-17-09-2026.json
 *   npx ts-node import-ces-timelogs.ts --file <same> --commit
 *
 * Dry run by default — it reports exactly what it would create and writes
 * nothing. Re-run with --commit.
 *
 * ── What is deliberately NOT imported ────────────────────────────────────
 * Logs longer than a day. Workway's timer had no auto-stop, so 93 of the 2,699
 * exported logs run past 24 hours — the worst is 6,744 hours, a timer started
 * in 2025 and never stopped. Those 93 carry 20,711 of the export's 27,865
 * hours. They are not work, they are an unstopped clock, and importing them
 * would put months of effort on a single day of somebody's timesheet and push
 * project cost into nonsense. Zero-minute logs go for the same reason.
 *
 * ── The holding project ──────────────────────────────────────────────────
 * Three quarters of the real logs have no project at all: social media, hiring
 * calls, documentation, internal meetings. That work happened and the hours are
 * real, but IssueTimeLog hangs off an Issue which hangs off a Project, so it
 * needs somewhere to live. It goes to one clearly-named internal project rather
 * than being spread across the delivery projects it did not belong to.
 *
 * ── Re-running ───────────────────────────────────────────────────────────
 * IssueTimeLog has no column for an external id, so a log already imported is
 * recognised by its natural key: same employee, same issue, same start instant.
 * For timer sessions that is unique in practice — one person cannot start two
 * timers in the same minute — so a second run adds nothing.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const FILE = getArg('file');
const COMMIT = process.argv.includes('--commit');
const COMPANY_ID = Number(getArg('company') || 1);

/** A log longer than this is an unstopped timer, not a day's work. */
const MAX_MINUTES = 24 * 60;

const HOLDING_PROJECT_NAME = 'Internal & Administrative Work';
const HOLDING_PROJECT_KEY = 'INT';

if (!FILE) {
  console.error('Usage: npx ts-node import-ces-timelogs.ts --file <timelogs.json> [--commit]');
  process.exit(1);
}

interface WorkwayLog {
  workway_id: number;
  employee_email: string;
  employee_name: string;
  project_name: string;
  task_heading: string;
  start_time: string;
  end_time: string;
  total_minutes: string | number;
  memo: string;
  approved: number;
}

/** Strip everything that punctuation and casing can disagree about. */
function norm(value: string): string {
  return (value || '')
    .replace(/&amp;/g, '&')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Workway prints "15-09-2026 01:52 pm" in the company's own timezone, with no
 * offset. Parsed as local time, which is what every other CES importer does and
 * what the attendance rows already in the database were built from.
 */
function parseStamp(raw: string): Date | null {
  if (!raw || raw === 'Paused') return null;
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ap] = m;
  let hour = parseInt(hh, 10) % 12;
  if (ap.toLowerCase() === 'pm') hour += 12;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), hour, Number(mi), 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function minutesOf(log: WorkwayLog): number {
  const n = Number(log.total_minutes);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const raw: WorkwayLog[] = JSON.parse(fs.readFileSync(FILE!, 'utf-8'));
  console.log(
    `\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${raw.length} exported logs from ${path.basename(FILE!)}\n`,
  );

  // ── Lookups ────────────────────────────────────────────────────────────
  const employees = await prisma.employee.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } },
  });
  const byEmail = new Map<string, number>();
  for (const e of employees) {
    if (e.user?.email) byEmail.set(e.user.email.trim().toLowerCase(), e.id);
  }

  const projects = await prisma.project.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, name: true, key: true },
  });
  const projectByName = new Map<string, { id: number; key: string }>();
  for (const p of projects) projectByName.set(norm(p.name), { id: p.id, key: p.key || '' });

  const issues = await prisma.issue.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, title: true, projectId: true, key: true },
  });
  /** Keyed by project + title: the same task name recurs across projects. */
  const issueByProjectTitle = new Map<string, number>();
  for (const i of issues) issueByProjectTitle.set(`${i.projectId}::${norm(i.title)}`, i.id);

  // Highest issue number per project, so generated keys continue the sequence.
  const nextIssueNum = new Map<number, number>();
  for (const i of issues) {
    const m = (i.key || '').match(/-(\d+)$/);
    const n = m ? parseInt(m[1], 10) : 0;
    nextIssueNum.set(i.projectId, Math.max(nextIssueNum.get(i.projectId) || 0, n));
  }

  // ── Plan ───────────────────────────────────────────────────────────────
  type Planned = {
    log: WorkwayLog;
    employeeId: number;
    projectKey: string | null; // null => the holding project
    taskTitle: string;
    startedAt: Date;
    endedAt: Date | null;
    durationMin: number;
    note: string | null;
  };

  const planned: Planned[] = [];
  const skipped = { runaway: 0, zero: 0, noEmployee: 0, badDate: 0, noTask: 0 };
  const unknownProjects = new Set<string>();
  const unmatchedEmails = new Set<string>();

  for (const log of raw) {
    const mins = minutesOf(log);
    if (mins <= 0) { skipped.zero++; continue; }
    if (mins > MAX_MINUTES) { skipped.runaway++; continue; }

    const employeeId = byEmail.get((log.employee_email || '').trim().toLowerCase());
    if (!employeeId) { skipped.noEmployee++; unmatchedEmails.add(log.employee_email); continue; }

    const startedAt = parseStamp(log.start_time);
    if (!startedAt) { skipped.badDate++; continue; }
    const endedAt = parseStamp(log.end_time);

    const title = (log.task_heading || '').replace(/&amp;/g, '&').trim();
    if (!title) { skipped.noTask++; continue; }

    let projectKey: string | null = null;
    if (log.project_name) {
      const hit = projectByName.get(norm(log.project_name));
      if (hit) projectKey = norm(log.project_name);
      else unknownProjects.add(log.project_name);
    }

    planned.push({
      log, employeeId, projectKey, taskTitle: title, startedAt, endedAt,
      durationMin: Math.round(mins),
      // §19's description. Often the only thing that says what two hours
      // against "Project Management" actually were.
      note: (log.memo || '').trim() || null,
    });
  }

  // ── Which issues have to exist ─────────────────────────────────────────
  const holdingNeeded = planned.some((p) => p.projectKey === null);
  let holdingProjectId: number | null =
    projectByName.get(norm(HOLDING_PROJECT_NAME))?.id ?? null;

  const issuesToCreate = new Map<string, { projectKeyNorm: string | null; title: string }>();
  for (const p of planned) {
    const pid = p.projectKey ? projectByName.get(p.projectKey)!.id : holdingProjectId;
    // The holding project may not exist yet on a dry run; its issues are all new.
    if (pid == null) {
      issuesToCreate.set(`HOLDING::${norm(p.taskTitle)}`, { projectKeyNorm: null, title: p.taskTitle });
      continue;
    }
    const k = `${pid}::${norm(p.taskTitle)}`;
    if (!issueByProjectTitle.has(k)) {
      issuesToCreate.set(k, { projectKeyNorm: p.projectKey, title: p.taskTitle });
    }
  }

  const hours = (n: number) => Math.round(n / 60);
  const totalMin = planned.reduce((s, p) => s + p.durationMin, 0);

  console.log('PLAN');
  console.log(`  logs to import        ${planned.length}  (${hours(totalMin).toLocaleString()} hours)`);
  console.log(`  employees involved    ${new Set(planned.map((p) => p.employeeId)).size}`);
  console.log(`  issues to create      ${issuesToCreate.size}`);
  console.log(`  holding project       ${holdingNeeded ? (holdingProjectId ? 'exists' : 'WILL BE CREATED') : 'not needed'}`);
  console.log('\nSKIPPED');
  console.log(`  runaway timers >24h   ${skipped.runaway}`);
  console.log(`  zero-minute logs      ${skipped.zero}`);
  console.log(`  unmatched employee    ${skipped.noEmployee}`);
  console.log(`  unparseable date      ${skipped.badDate}`);
  console.log(`  no task name          ${skipped.noTask}`);

  if (unmatchedEmails.size) {
    console.log('\n  emails with no ERP account:');
    for (const e of unmatchedEmails) console.log(`    ${e}`);
  }
  if (unknownProjects.size) {
    console.log('\n  project names with no ERP project (logs go to the holding project):');
    for (const p of unknownProjects) console.log(`    ${p}`);
  }

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit.\n');
    await prisma.$disconnect();
    return;
  }

  // ── Write ──────────────────────────────────────────────────────────────
  if (holdingNeeded && !holdingProjectId) {
    const created = await prisma.project.create({
      data: {
        name: HOLDING_PROJECT_NAME,
        key: HOLDING_PROJECT_KEY,
        companyId: COMPANY_ID,
        description:
          'Time migrated from Workway that was logged against a task with no project — ' +
          'internal, administrative and support work. Created by import-ces-timelogs.ts.',
        billingType: 'NON_BILLABLE',
        // Migrated time is hand-entered by definition; the timer never saw it.
        allowManualTimeLogging: true,
      },
      select: { id: true, key: true },
    });
    holdingProjectId = created.id;
    projectByName.set(norm(HOLDING_PROJECT_NAME), { id: created.id, key: created.key || HOLDING_PROJECT_KEY });
    console.log(`\ncreated holding project #${created.id} ${HOLDING_PROJECT_NAME}`);
  }

  // Create the missing issues, continuing each project's key sequence.
  let issuesCreated = 0;
  for (const p of planned) {
    const proj = p.projectKey ? projectByName.get(p.projectKey)! : { id: holdingProjectId!, key: HOLDING_PROJECT_KEY };
    const k = `${proj.id}::${norm(p.taskTitle)}`;
    if (issueByProjectTitle.has(k)) continue;

    const n = (nextIssueNum.get(proj.id) || 0) + 1;
    nextIssueNum.set(proj.id, n);
    const issue = await prisma.issue.create({
      data: {
        key: `${proj.key || 'TASK'}-${n}`,
        title: p.taskTitle,
        projectId: proj.id,
        companyId: COMPANY_ID,
        // Time was logged against it, so it was worked on and is not "to do".
        status: 'DONE',
        description: 'Migrated from Workway by import-ces-timelogs.ts.',
      },
      select: { id: true },
    });
    issueByProjectTitle.set(k, issue.id);
    issuesCreated++;
  }
  console.log(`created ${issuesCreated} issue(s)`);

  // Insert the logs, skipping any already present.
  let inserted = 0;
  let duplicate = 0;
  let backfilled = 0;
  for (const p of planned) {
    const proj = p.projectKey ? projectByName.get(p.projectKey)! : { id: holdingProjectId!, key: HOLDING_PROJECT_KEY };
    const issueId = issueByProjectTitle.get(`${proj.id}::${norm(p.taskTitle)}`)!;

    const existing = await prisma.issueTimeLog.findFirst({
      where: { employeeId: p.employeeId, issueId, startedAt: p.startedAt },
      select: { id: true, note: true },
    });
    if (existing) {
      // The note column arrived after the first import, so a row already here
      // may be missing it. Fill it rather than skipping the row outright —
      // that is what makes a second run useful instead of merely harmless.
      if (!existing.note && p.note) {
        await prisma.issueTimeLog.update({ where: { id: existing.id }, data: { note: p.note } });
        backfilled++;
      } else {
        duplicate++;
      }
      continue;
    }

    await prisma.issueTimeLog.create({
      data: {
        issueId,
        employeeId: p.employeeId,
        startedAt: p.startedAt,
        endedAt: p.endedAt,
        durationMin: p.durationMin,
        note: p.note,
        // Migrated time was not observed by our timer, and saying otherwise
        // would make it indistinguishable from time this system recorded.
        source: 'MANUAL',
      },
    });
    inserted++;
  }

  console.log(
    `\ninserted ${inserted} time log(s), backfilled a note on ${backfilled}, ` +
    `skipped ${duplicate} already complete`,
  );
  console.log('DONE.\n');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
