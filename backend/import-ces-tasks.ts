import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as xlsx from 'xlsx';
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

if (!FILE) {
  console.error('Usage: npx ts-node import-ces-tasks.ts --file <path.xlsx> [--commit]');
  process.exit(1);
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface EmployeeLite { id: number; firstName: string; lastName: string | null; }

function buildNameMaps(employees: EmployeeLite[]) {
  const fullNameMap = new Map<string, number>();
  const firstNameMap = new Map<string, number[]>();
  for (const e of employees) {
    const full = normalize(`${e.firstName} ${e.lastName || ''}`);
    fullNameMap.set(full, e.id);
    const first = normalize(e.firstName);
    firstNameMap.set(first, [...(firstNameMap.get(first) || []), e.id]);
  }
  return { fullNameMap, firstNameMap };
}

type NameMaps = ReturnType<typeof buildNameMaps>;

function matchName(token: string, maps: NameMaps): { id: number } | { ambiguous: true } | null {
  const norm = normalize(token);
  if (!norm) return null;
  const exact = maps.fullNameMap.get(norm);
  if (exact) return { id: exact };
  const firstOnly = maps.firstNameMap.get(norm);
  if (firstOnly && firstOnly.length === 1) return { id: firstOnly[0] };
  if (firstOnly && firstOnly.length > 1) return { ambiguous: true };
  return null;
}

function matchAssignees(raw: any, maps: NameMaps): { ids: number[]; names: string[]; unmatched: string[]; ambiguous: string[] } {
  const tokens = String(raw || '').split(',').map((t) => t.trim()).filter((t) => t && t !== '--');
  const ids: number[] = [];
  const names: string[] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  for (const token of tokens) {
    const m = matchName(token, maps);
    if (!m) { unmatched.push(token); continue; }
    if ('ambiguous' in m) { ambiguous.push(token); continue; }
    if (!ids.includes(m.id)) { ids.push(m.id); names.push(token); }
  }
  return { ids, names, unmatched, ambiguous };
}

// dd-mm-yyyy, "Today", "Yesterday", or "--"
function parseTaskDate(raw: any): Date | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '--') return null;
  if (trimmed === 'Today') {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (trimmed === 'Yesterday') {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  const m = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
}

const STATUS_MAP: Record<string, { issueStatus: string; columnType: string }> = {
  'Completed': { issueStatus: 'DONE', columnType: 'DONE' },
  'Incomplete': { issueStatus: 'TODO', columnType: 'TODO' },
  'To Do List': { issueStatus: 'TODO', columnType: 'TODO' },
  'Recurring Tasks': { issueStatus: 'TODO', columnType: 'TODO' },
  'In Progress': { issueStatus: 'IN_PROGRESS', columnType: 'IN_PROGRESS' },
  'Review Tasks': { issueStatus: 'IN_REVIEW', columnType: 'REVIEW' },
  'Waiting Approval': { issueStatus: 'IN_REVIEW', columnType: 'REVIEW' }
};

const PRIORITY_MAP: Record<string, string> = {
  'High': 'HIGH',
  'Medium': 'MEDIUM',
  'Low': 'LOW'
};

function decodeHtmlEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
}

interface RowPlan {
  rowIndex: number;
  taskId: any;
  title: string;
  projectName: string;
  projectId: number;
  projectKey: string;
  key: string;
  status: string;
  columnType: string;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  assigneeId: number | null;
  memberIds: number[];
  description: string;
}

async function main() {
  const company = await prisma.company.findFirst();
  if (!company) { console.error('No company found.'); process.exit(1); }
  const companyId = company.id;
  console.log(`Company: ${company.name} (id ${companyId})`);

  const employees = await prisma.employee.findMany({
    where: { companyId },
    select: { id: true, firstName: true, lastName: true }
  });
  const maps = buildNameMaps(employees);
  console.log(`Loaded ${employees.length} employees for matching.`);

  const projects = await prisma.project.findMany({
    where: { companyId },
    select: { id: true, key: true, name: true }
  });
  const projectMap = new Map<string, { id: number; key: string; name: string }>();
  for (const p of projects) projectMap.set(normalize(p.name), p);
  console.log(`Loaded ${projects.length} projects for matching.\n`);

  // Existing issue count per project (for key numbering) + dedupe marker set
  const issueCounts = new Map<number, number>();
  const existingTaskIds = new Set<string>();
  const existingIssues = await prisma.issue.findMany({
    where: { companyId },
    select: { projectId: true, description: true }
  });
  for (const iss of existingIssues) {
    issueCounts.set(iss.projectId, (issueCounts.get(iss.projectId) || 0) + 1);
    const m = iss.description?.match(/\[CES Task Id: (\d+)\]/);
    if (m) existingTaskIds.add(m[1]);
  }

  // Board columns per project, keyed by columnType
  const boardColumnsByProject = new Map<number, Map<string, number>>();
  const boards = await prisma.board.findMany({
    where: { project: { companyId } },
    include: { columns: true }
  });
  for (const b of boards) {
    const colMap = boardColumnsByProject.get(b.projectId) || new Map<string, number>();
    for (const c of b.columns) colMap.set(c.type, c.id);
    boardColumnsByProject.set(b.projectId, colMap);
  }

  const wb = xlsx.readFile(path.resolve(FILE!));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw: any[] = xlsx.utils.sheet_to_json(sheet, { range: 1, defval: null });
  console.log(`Parsed ${raw.length} rows from sheet.\n`);

  const plans: RowPlan[] = [];
  const skippedNoProject: number[] = [];
  const skippedUnmatchedProject = new Map<string, number>();
  const skippedAlreadyImported: number[] = [];
  const unmatchedAssignees = new Map<string, number>();
  const ambiguousAssignees = new Map<string, number>();
  const unmatchedStatus = new Map<string, number>();

  raw.forEach((row: any, idx: number) => {
    const taskId = row['Id'];
    const projectRaw = row['Project'];
    if (!projectRaw || projectRaw === '--') {
      skippedNoProject.push(idx);
      return;
    }
    if (existingTaskIds.has(String(taskId))) {
      skippedAlreadyImported.push(idx);
      return;
    }

    const project = projectMap.get(normalize(String(projectRaw)));
    if (!project) {
      skippedUnmatchedProject.set(String(projectRaw), (skippedUnmatchedProject.get(String(projectRaw)) || 0) + 1);
      return;
    }

    const statusRaw = String(row['Task Status'] || '').trim();
    const statusInfo = STATUS_MAP[statusRaw];
    if (!statusInfo) {
      unmatchedStatus.set(statusRaw, (unmatchedStatus.get(statusRaw) || 0) + 1);
      return;
    }

    const { ids: assigneeIds, unmatched, ambiguous } = matchAssignees(row['Assigned'], maps);
    for (const u of unmatched) unmatchedAssignees.set(u, (unmatchedAssignees.get(u) || 0) + 1);
    for (const a of ambiguous) ambiguousAssignees.set(a, (ambiguousAssignees.get(a) || 0) + 1);

    const priorityRaw = String(row['Priority'] || '').trim();
    const priority = PRIORITY_MAP[priorityRaw] || 'MEDIUM';

    const count = (issueCounts.get(project.id) || 0) + 1;
    issueCounts.set(project.id, count);
    const key = `${project.key}-${count}`;

    const codeRaw = row['Code'];
    const categoryRaw = row['Task category'];
    const clientRaw = row['Client'];
    const hoursRaw = row['Hours Logged'];
    const metaParts: string[] = [`[CES Task Id: ${taskId}]`];
    if (codeRaw && codeRaw !== '--') metaParts.push(`Code: ${codeRaw}`);
    if (categoryRaw && categoryRaw !== '--') metaParts.push(`Category: ${decodeHtmlEntities(String(categoryRaw))}`);
    if (clientRaw && clientRaw !== '--') metaParts.push(`Client: ${clientRaw}`);
    if (hoursRaw && hoursRaw !== '0s') metaParts.push(`Hours logged: ${hoursRaw}`);
    const description = `Imported from CES task tracker. ${metaParts.join(' | ')}`;

    plans.push({
      rowIndex: idx,
      taskId,
      title: decodeHtmlEntities(String(row['Tasks'] || '').trim()) || `(untitled task ${taskId})`,
      projectName: String(projectRaw),
      projectId: project.id,
      projectKey: project.key,
      key,
      status: statusInfo.issueStatus,
      columnType: statusInfo.columnType,
      priority,
      startDate: parseTaskDate(row['Start Date']),
      dueDate: parseTaskDate(row['Due Date']),
      assigneeId: assigneeIds[0] ?? null,
      memberIds: assigneeIds,
      description
    });
  });

  // --- Summary ---
  console.log('=== Plan Summary ===');
  console.log(`Rows in file: ${raw.length}`);
  console.log(`Skipped (no project / "--"): ${skippedNoProject.length}`);
  console.log(`Skipped (already imported, matched by CES Task Id): ${skippedAlreadyImported.length}`);
  console.log(`Skipped (project name not found in DB): ${[...skippedUnmatchedProject.values()].reduce((a, b) => a + b, 0)}`);
  if (skippedUnmatchedProject.size > 0) {
    console.log('  Unmatched project names:');
    for (const [name, cnt] of [...skippedUnmatchedProject.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    - "${name}" (${cnt} task(s))`);
    }
  }
  if (unmatchedStatus.size > 0) {
    console.log('Skipped (unrecognized Task Status):');
    for (const [s, cnt] of unmatchedStatus.entries()) console.log(`    - "${s}" (${cnt})`);
  }
  console.log(`\nIssues to create: ${plans.length}`);
  console.log(`Tasks with no assignee matched: ${plans.filter(p => p.assigneeId === null).length}`);
  if (unmatchedAssignees.size > 0) {
    console.log('\nAssignee names not found among employees (task left unassigned for these):');
    for (const [name, cnt] of [...unmatchedAssignees.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  - "${name}" (${cnt} task(s))`);
    }
  }
  if (ambiguousAssignees.size > 0) {
    console.log('\nAmbiguous assignee first names (multiple employees match, skipped):');
    for (const [name, cnt] of ambiguousAssignees.entries()) console.log(`  - "${name}" (${cnt} task(s))`);
  }

  const memberAdds = new Map<number, Set<number>>(); // projectId -> employeeIds
  for (const p of plans) {
    for (const empId of p.memberIds) {
      if (!memberAdds.has(p.projectId)) memberAdds.set(p.projectId, new Set());
      memberAdds.get(p.projectId)!.add(empId);
    }
  }
  const totalMemberPairs = [...memberAdds.values()].reduce((a, s) => a + s.size, 0);
  console.log(`\nProject-employee membership pairs implied by assignments: ${totalMemberPairs} (existing memberships will be skipped)`);

  console.log('\nSample of planned issues (first 15):');
  for (const p of plans.slice(0, 15)) {
    console.log(`  ${p.key} [${p.projectName}] "${p.title.slice(0, 60)}" status=${p.status} priority=${p.priority} assignee=${p.assigneeId ?? 'none'}`);
  }

  if (!COMMIT) {
    console.log('\nDry run only. Re-run with --commit to apply.');
    await pool.end();
    return;
  }

  console.log('\n=== Committing ===');

  // 1. Ensure ProjectMember rows exist
  let membersCreated = 0;
  for (const [projectId, empIds] of memberAdds.entries()) {
    for (const empId of empIds) {
      const existing = await prisma.projectMember.findUnique({
        where: { projectId_employeeId: { projectId, employeeId: empId } }
      });
      if (!existing) {
        await prisma.projectMember.create({ data: { projectId, employeeId: empId, role: 'MEMBER' } });
        membersCreated++;
      }
    }
  }
  console.log(`Created ${membersCreated} new project membership(s).`);

  // 2. Create issues (+ position tracking per column)
  const positionByColumn = new Map<number, number>();
  let issuesCreated = 0;
  let failures = 0;
  for (const p of plans) {
    const colMap = boardColumnsByProject.get(p.projectId);
    const columnId = colMap?.get(p.columnType) ?? null;
    const position = columnId ? (positionByColumn.get(columnId) ?? 0) : 0;
    if (columnId) positionByColumn.set(columnId, position + 1);

    try {
      const issue = await prisma.issue.create({
        data: {
          key: p.key,
          title: p.title,
          description: p.description,
          type: 'TASK',
          status: p.status,
          priority: p.priority,
          projectId: p.projectId,
          companyId,
          columnId,
          assigneeId: p.assigneeId,
          position,
          startDate: p.startDate,
          dueDate: p.dueDate,
          workCompletedAt: p.status === 'DONE' ? (p.dueDate || p.startDate) : null
        }
      });

      if (p.memberIds.length > 0) {
        await prisma.issueMember.createMany({
          data: p.memberIds.map((employeeId) => ({ issueId: issue.id, employeeId })),
          skipDuplicates: true
        });
      }
      issuesCreated++;
    } catch (e: any) {
      failures++;
      console.error(`Failed to create issue for task ${p.taskId} (${p.key}): ${e.message}`);
    }
  }

  console.log(`\nCommitted: ${issuesCreated} issue(s) created, ${failures} failure(s).`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
