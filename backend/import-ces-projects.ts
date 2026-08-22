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
const FALLBACK_LEAD = getArg('fallback-lead');
const COMMIT = process.argv.includes('--commit');

if (!FILE || !FALLBACK_LEAD) {
  console.error('Usage: npx ts-node import-ces-projects.ts --file <path.xlsx> --fallback-lead <employeeId> [--commit]');
  process.exit(1);
}
const fallbackLeadId = parseInt(FALLBACK_LEAD, 10);

const CATEGORY_FIXES: Record<string, string> = {
  'implentation and migration': 'Implementation and Migration',
  'business expension': 'Business Expansion'
};

function cleanCategory(raw: any): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '--') return null;
  const key = trimmed.toLowerCase().replace(/\s+/g, ' ');
  return CATEGORY_FIXES[key] || trimmed;
}

function parseProgress(raw: any): number | null {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/(\d+)\s*%/);
  return m ? parseInt(m[1], 10) : null;
}

function deriveWorkStatus(rawStatus: any, progress: number | null): { workStatus: string; flag?: string } {
  const status = typeof rawStatus === 'string' ? rawStatus.trim() : '';
  const p = progress ?? 0;

  if (!status) {
    const inferred = p === 100 ? 'FINISHED' : 'IN_PROGRESS';
    return { workStatus: inferred, flag: `missing status, inferred ${inferred} from ${p}% complete` };
  }
  if (status === 'Not Started') {
    if (p === 100) return { workStatus: 'FINISHED', flag: `labeled "Not Started" but 100% complete, corrected to FINISHED` };
    if (p > 0) return { workStatus: 'IN_PROGRESS', flag: `labeled "Not Started" but ${p}% complete, corrected to IN_PROGRESS` };
    return { workStatus: 'NOT_STARTED' };
  }
  if (status === 'In Progress') return { workStatus: 'IN_PROGRESS' };
  if (status === 'Finished') return { workStatus: 'FINISHED' };
  return { workStatus: 'IN_PROGRESS', flag: `unrecognized status "${status}", defaulted to IN_PROGRESS` };
}

function parseExcelDate(raw: any): Date | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const m = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
}

async function generateKey(name: string, companyId: number): Promise<string> {
  const words = name.split(' ').filter(w => w.length > 0);
  const baseKey = words.length >= 2
    ? (words[0].substring(0, 2) + words[1][0]).toUpperCase()
    : name.substring(0, 3).toUpperCase();
  let finalKey = baseKey;
  let counter = 1;
  while (true) {
    const existing = await prisma.project.findUnique({ where: { key_companyId: { key: finalKey, companyId } } });
    if (!existing) break;
    finalKey = `${baseKey}${counter}`;
    counter++;
  }
  return finalKey;
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

interface Plan {
  rowNum: any;
  name: string;
  category: string | null;
  progress: number | null;
  workStatus: string;
  startDate: Date | null;
  endDate: Date | null;
  description: string;
  leadId: number;
  leadName: string;
  memberIds: number[];
  memberNames: string[];
  unmatched: string[];
  ambiguous: string[];
  flags: string[];
}

async function main() {
  const company = await prisma.company.findFirst();
  if (!company) {
    console.error('No company found.');
    process.exit(1);
  }
  const companyId = company.id;
  console.log(`Company: ${company.name} (id ${companyId})`);

  const employees = await prisma.employee.findMany({
    where: { companyId },
    select: { id: true, firstName: true, lastName: true }
  });
  const maps = buildNameMaps(employees);
  console.log(`Loaded ${employees.length} employees for matching.\n`);

  const wb = xlsx.readFile(path.resolve(FILE!));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw: any[] = xlsx.utils.sheet_to_json(sheet, { range: 1, defval: null });

  const rows = raw
    .map((r: any) => ({
      rowNum: r['#'],
      code: r['Code'],
      project: r['Project'],
      members: r['Project Members'],
      startDate: r['Start Date'],
      deadline: r['Deadline'],
      completion: r['Completion'],
      status: r['Project Status'],
      category: r['Project Category']
    }))
    .filter((r) => r.project);

  console.log(`Parsed ${rows.length} project rows.\n`);

  const plans: Plan[] = rows.map((row) => {
    const flags: string[] = [];
    const category = cleanCategory(row.category);
    const progress = parseProgress(row.completion);
    const { workStatus, flag: statusFlag } = deriveWorkStatus(row.status, progress);
    if (statusFlag) flags.push(statusFlag);

    const startDate = parseExcelDate(row.startDate);
    const endDate = parseExcelDate(row.deadline);

    const tokens = String(row.members || '').split(',').map((t) => t.trim()).filter(Boolean);
    const matchedIds: number[] = [];
    const matchedNames: string[] = [];
    const unmatched: string[] = [];
    const ambiguous: string[] = [];

    for (const token of tokens) {
      const m = matchName(token, maps);
      if (!m) {
        unmatched.push(token);
        continue;
      }
      if ('ambiguous' in m) {
        ambiguous.push(token);
        continue;
      }
      if (!matchedIds.includes(m.id)) {
        matchedIds.push(m.id);
        matchedNames.push(token);
      }
    }

    let leadId: number;
    let leadName: string;
    let memberIds: number[];
    let memberNames: string[];
    if (matchedIds.length > 0) {
      leadId = matchedIds[0];
      leadName = matchedNames[0];
      memberIds = matchedIds.slice(1);
      memberNames = matchedNames.slice(1);
    } else {
      leadId = fallbackLeadId;
      leadName = `(fallback #${fallbackLeadId})`;
      memberIds = [];
      memberNames = [];
      flags.push('zero members matched — used fallback lead, no members attached');
    }

    const codeNote = row.code ? `, code ${row.code}` : '';
    const formerNote = unmatched.length
      ? ` Former team members (no longer with the company, not assigned): ${unmatched.join(', ')}.`
      : '';
    const description = `Imported from CES portfolio tracker (row #${row.rowNum}${codeNote}).${formerNote}`;

    return {
      rowNum: row.rowNum,
      name: String(row.project).trim(),
      category,
      progress,
      workStatus,
      startDate,
      endDate,
      description,
      leadId,
      leadName,
      memberIds,
      memberNames,
      unmatched,
      ambiguous,
      flags
    };
  });

  for (const p of plans) {
    console.log(`#${p.rowNum} ${p.name}`);
    console.log(`  category: ${p.category ?? '(none)'} | progress: ${p.progress ?? '(none)'}% | workStatus: ${p.workStatus}`);
    console.log(`  start: ${p.startDate ? p.startDate.toISOString().slice(0, 10) : '(none)'}  end: ${p.endDate ? p.endDate.toISOString().slice(0, 10) : '(none)'}`);
    console.log(`  lead: ${p.leadName} (id ${p.leadId})`);
    console.log(`  members: ${p.memberNames.length ? p.memberNames.join(', ') : '(none)'}`);
    if (p.unmatched.length) console.log(`  UNMATCHED: ${p.unmatched.join(', ')}`);
    if (p.ambiguous.length) console.log(`  AMBIGUOUS: ${p.ambiguous.join(', ')}`);
    if (p.flags.length) console.log(`  FLAGS: ${p.flags.join('; ')}`);
    console.log('');
  }

  const allUnmatched = new Set(plans.flatMap((p) => p.unmatched));
  const allAmbiguous = new Set(plans.flatMap((p) => p.ambiguous));
  const zeroMemberProjects = plans.filter((p) => p.flags.some((f) => f.includes('fallback lead')));
  const flaggedStatus = plans.filter((p) => p.flags.some((f) => f.includes('corrected') || f.includes('inferred')));

  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log(`  Total rows: ${plans.length}`);
  console.log(`  Unique unmatched names: ${allUnmatched.size}${allUnmatched.size ? ' -> ' + [...allUnmatched].join(', ') : ''}`);
  console.log(`  Unique ambiguous names: ${allAmbiguous.size}${allAmbiguous.size ? ' -> ' + [...allAmbiguous].join(', ') : ''}`);
  console.log(`  Projects with zero matched members (fallback lead used): ${zeroMemberProjects.length}`);
  console.log(`  Rows with corrected/inferred status: ${flaggedStatus.length}`);
  console.log('='.repeat(60));

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to create these projects.');
    return;
  }

  console.log('\nCOMMITTING...\n');
  let created = 0;
  let failed = 0;
  let memberWarnings = 0;
  const errors: { row: any; name: string; reason: string }[] = [];

  for (const p of plans) {
    try {
      const key = await generateKey(p.name, companyId);
      const project = await prisma.project.create({
        data: {
          name: p.name,
          key,
          description: p.description,
          color: '#2563eb',
          icon: 'folder',
          category: p.category,
          progress: p.progress,
          workStatus: p.workStatus,
          startDate: p.startDate,
          endDate: p.endDate,
          companyId,
          leadId: p.leadId,
          members: { create: [{ employeeId: p.leadId, role: 'ADMIN' }] },
          boards: {
            create: {
              name: 'Main Board',
              columns: {
                create: [
                  { name: 'To Do', color: '#6b7280', position: 0, isSystem: true, type: 'TODO' },
                  { name: 'In Progress', color: '#3b82f6', position: 1, isSystem: true, type: 'IN_PROGRESS' },
                  { name: 'In Review', color: '#8b5cf6', position: 2, isSystem: true, type: 'REVIEW' },
                  { name: 'Done', color: '#22c55e', position: 3, isSystem: true, type: 'DONE' },
                  { name: 'Archived', color: '#9ca3af', position: 4, isSystem: true, type: 'DONE' }
                ]
              }
            }
          }
        }
      });

      for (const employeeId of p.memberIds) {
        try {
          await prisma.projectMember.create({ data: { projectId: project.id, employeeId, role: 'MEMBER' } });
        } catch (e: any) {
          memberWarnings++;
          console.warn(`    warning: failed to add member ${employeeId} to "${p.name}": ${e.message || e}`);
        }
      }

      created++;
      console.log(`  created "${p.name}" (id ${project.id}, key ${key})`);
    } catch (e: any) {
      failed++;
      errors.push({ row: p.rowNum, name: p.name, reason: e.message || String(e) });
      console.error(`  FAILED "${p.name}": ${e.message || e}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`DONE. Created: ${created}  Failed: ${failed}  Member warnings: ${memberWarnings}`);
  if (errors.length) {
    console.log('Errors:');
    errors.forEach((e) => console.log(`  row #${e.row} "${e.name}": ${e.reason}`));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
