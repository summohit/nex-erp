import { BadRequestException, Injectable } from '@nestjs/common';
import * as xlsx from 'xlsx';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { IssuesService } from './issues/issues.service';
import { PROJECT_ROLE } from './project-roles';

/**
 * Task export / import in the "template project task" layout.
 *
 * One sheet, one row per task. Export writes the template columns plus a few
 * read-only extras; the hidden-in-plain-sight "Task ID" is what makes a
 * re-import UPDATE the task instead of creating a copy. Import always runs as
 * preview first: every row is checked and labelled, and only valid rows are
 * written. Rows that fail come back as a file to fix and re-upload.
 */

/** The template's columns, in its order. Extras follow on export. */
export const TEMPLATE_COLUMNS = [
  'S.No', 'Project Name', 'Project Code', 'Task Name', 'Task Description', 'Phase',
  'Assign Hours', 'Pre-Requisite', 'Dependency', 'Assign to', 'SME / Govern',
  'Start Date', 'End Date',
] as const;
const EXTRA_COLUMNS = ['Task ID', 'Task Key', 'Status', 'Logged Hours', 'Created Date'] as const;

export interface ImportRowResult {
  row: number;           // spreadsheet row number (header = 1)
  sNo: string;
  project: string;
  title: string;
  action: 'CREATE' | 'UPDATE' | 'SKIP';
  ok: boolean;
  errors: string[];
  warnings: string[];
  taskKey?: string;
}

interface ParsedRow {
  row: number;
  raw: Record<string, any>;
  sNo: string;
  projectId?: number;
  projectLabel: string;
  title: string;
  description: string | null;
  phaseId?: number | null;
  hours?: number | null;
  prerequisites: string | null;
  dependencyRefs: string[];
  assigneeIds: number[];
  smeId?: number | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  taskId?: number;
  errors: string[];
  warnings: string[];
}

@Injectable()
export class TaskTransferService {
  constructor(private prisma: PrismaService, private issues: IssuesService) {}

  // ── Export ────────────────────────────────────────────────────────────────

  async exportTasks(
    companyId: number,
    opts: { projectIds?: number[]; includeDone?: boolean },
  ): Promise<Buffer> {
    const projects = await this.prisma.project.findMany({
      where: {
        companyId, isSystem: false,
        ...(opts.projectIds?.length ? { id: { in: opts.projectIds } } : {}),
      },
      select: { id: true, name: true, key: true },
      orderBy: { name: 'asc' },
    });
    const projectIds = projects.map((p) => p.id);

    const tasks = await this.prisma.issue.findMany({
      where: {
        companyId, projectId: { in: projectIds }, isArchived: false,
        ...(opts.includeDone ? {} : { status: { notIn: ['DONE', 'CLOSED'] } }),
      },
      select: {
        id: true, key: true, title: true, description: true, status: true,
        estimatedHours: true, prerequisites: true, startDate: true, dueDate: true, createdAt: true,
        projectId: true,
        phase: { select: { name: true } },
        assignee: { select: { user: { select: { email: true } } } },
        members: { select: { employee: { select: { user: { select: { email: true } } } } } },
        sme: { select: { user: { select: { email: true } } } },
        blockedBy: { select: { dependsOnIssue: { select: { key: true } } } },
        timeLogs: { select: { durationMin: true } },
      },
      orderBy: [{ projectId: 'asc' }, { createdAt: 'asc' }],
    } as any) as any[];

    const byId = new Map(projects.map((p) => [p.id, p]));
    const rows = tasks.map((t, i) => {
      const p = byId.get(t.projectId)!;
      const emails = t.members?.length
        ? t.members.map((m: any) => m.employee?.user?.email).filter(Boolean)
        : [t.assignee?.user?.email].filter(Boolean);
      const logged = (t.timeLogs || []).reduce((s: number, l: any) => s + (l.durationMin || 0), 0) / 60;
      return [
        i + 1, p.name, p.key, t.title, this.plainText(t.description), t.phase?.name ?? '',
        t.estimatedHours ?? '', t.prerequisites ?? '',
        (t.blockedBy || []).map((d: any) => d.dependsOnIssue?.key).filter(Boolean).join(', '),
        emails.join(', '), t.sme?.user?.email ?? '',
        this.day(t.startDate), this.day(t.dueDate),
        t.id, t.key, t.status, Math.round(logged * 100) / 100, this.day(t.createdAt),
      ];
    });

    return await this.workbook(
      [[...TEMPLATE_COLUMNS, ...EXTRA_COLUMNS], ...rows],
      await this.referenceRows(companyId, projectIds),
    );
  }

  /** The blank template, with the valid phases and people on a second sheet. */
  async template(companyId: number, projectIds?: number[]): Promise<Buffer> {
    const projects = projectIds?.length
      ? await this.prisma.project.findMany({ where: { companyId, id: { in: projectIds } }, select: { id: true, name: true, key: true } })
      : [];
    const sample = projects.length === 1
      ? [[1, projects[0].name, projects[0].key, '', '', '', '', '', '', '', '', '', '']]
      : [];
    return await this.workbook(
      [[...TEMPLATE_COLUMNS], ...sample],
      await this.referenceRows(companyId, projects.map((p) => p.id)),
    );
  }

  // ── Import ────────────────────────────────────────────────────────────────

  /** Check every row; write nothing. */
  async preview(companyId: number, file: Buffer, scopeProjectId?: number) {
    const parsed = await this.parse(companyId, file, scopeProjectId);
    return this.summarise(parsed);
  }

  /** Write the valid rows. Returns the per-row outcome and a file of failures. */
  async import(
    companyId: number, file: Buffer, actorEmployeeId: number, role: string | undefined,
    scopeProjectId?: number,
  ) {
    const parsed = await this.parse(companyId, file, scopeProjectId);
    const keyByRow = new Map<string, { id: number; projectId: number }>(); // S.No → task

    // Pass 1: create / update the tasks themselves.
    for (const r of parsed) {
      if (r.errors.length) continue;
      try {
        let id = r.taskId;
        if (id) {
          await this.prisma.issue.update({
            where: { id },
            data: {
              title: r.title,
              description: r.description,
              ...(r.phaseId !== undefined ? { phaseId: r.phaseId } : {}),
              ...(r.hours !== undefined ? { estimatedHours: r.hours } : {}),
              prerequisites: r.prerequisites,
              ...(r.smeId !== undefined ? { smeId: r.smeId } : {}),
              ...(r.startDate !== undefined ? { startDate: r.startDate } : {}),
              ...(r.dueDate !== undefined ? { dueDate: r.dueDate } : {}),
            },
          });
        } else {
          // Through IssuesService so permissions, the board column, the task
          // number and the PM-approval rule are exactly those of the board.
          const created: any = await this.issues.createIssue(companyId, actorEmployeeId, r.projectId!, {
            title: r.title,
            description: r.description,
            phaseId: r.phaseId ?? undefined,
            estimatedHours: r.hours ?? undefined,
            startDate: r.startDate ?? undefined,
            dueDate: r.dueDate ?? undefined,
            assigneeId: r.assigneeIds[0],
          }, role);
          id = created.id;
          await this.prisma.issue.update({
            where: { id },
            data: { prerequisites: r.prerequisites, smeId: r.smeId ?? null },
          });
        }
        if (r.assigneeIds.length) {
          await this.prisma.$transaction([
            this.prisma.issueMember.deleteMany({ where: { issueId: id! } }),
            this.prisma.issueMember.createMany({
              data: r.assigneeIds.map((employeeId) => ({ issueId: id!, employeeId })),
              skipDuplicates: true,
            }),
            this.prisma.issue.update({ where: { id: id! }, data: { assigneeId: r.assigneeIds[0] } }),
          ]);
        }
        const done = await this.prisma.issue.findUnique({ where: { id: id! }, select: { key: true } });
        (r as any).taskKey = done?.key;
        if (r.sNo) keyByRow.set(r.sNo, { id: id!, projectId: r.projectId! });
        (r as any).savedId = id;
      } catch (e: any) {
        r.errors.push(e?.response?.message || e?.message || 'Could not save this task');
      }
    }

    // Pass 2: dependencies, now that every row in the file has an id.
    for (const r of parsed) {
      const id = (r as any).savedId as number | undefined;
      if (!id || !r.dependencyRefs.length) continue;
      for (const ref of r.dependencyRefs) {
        const target = keyByRow.get(ref) ?? await this.findTaskByRef(companyId, r.projectId!, ref);
        if (!target) { r.warnings.push(`Dependency "${ref}" not found — not linked`); continue; }
        if (target.id === id) continue;
        await this.prisma.issueDependency.upsert({
          where: { issueId_dependsOnIssueId: { issueId: id, dependsOnIssueId: target.id } },
          update: {},
          create: { issueId: id, dependsOnIssueId: target.id, companyId, createdById: actorEmployeeId },
        });
      }
    }

    const summary = this.summarise(parsed);
    const failed = parsed.filter((r) => r.errors.length);
    const failedFile = failed.length
      ? (await this.workbook([
          [...TEMPLATE_COLUMNS, 'Task ID', 'Errors'],
          ...failed.map((r) => [
            ...TEMPLATE_COLUMNS.map((c) => r.raw[c] ?? ''), r.raw['Task ID'] ?? '', r.errors.join('; '),
          ]),
        ])).toString('base64')
      : null;
    return { ...summary, failedFile };
  }

  // ── Parsing & validation ─────────────────────────────────────────────────

  private async parse(companyId: number, file: Buffer, scopeProjectId?: number): Promise<ParsedRow[]> {
    let sheet: xlsx.WorkSheet;
    try {
      const wb = xlsx.read(file, { type: 'buffer', cellDates: true });
      sheet = wb.Sheets[wb.SheetNames[0]];
    } catch {
      throw new BadRequestException('That file could not be read as Excel or CSV.');
    }
    const json: any[] = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: true });
    // Headers in the template carry stray spaces ("Project Name "): match loosely.
    const norm = (k: string) => String(k).trim().toLowerCase().replace(/\s+/g, ' ');
    const rows = json.map((obj) => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj)) {
        const col = [...TEMPLATE_COLUMNS, ...EXTRA_COLUMNS].find((c) => norm(c) === norm(k));
        if (col) out[col] = v;
      }
      return out;
    }).filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''));
    if (!rows.length) throw new BadRequestException('No task rows found under the header row.');
    if (rows.length > 1000) throw new BadRequestException('Up to 1,000 tasks per file.');

    // Look-ups, loaded once.
    const [projects, phases, phasesExist] = await Promise.all([
      this.prisma.project.findMany({
        where: { companyId, isSystem: false, ...(scopeProjectId ? { id: scopeProjectId } : {}) },
        select: {
          id: true, name: true, key: true, leadId: true,
          members: { select: { employeeId: true, role: true } },
        },
      }),
      this.prisma.projectPhase.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true } }),
      this.prisma.projectPhase.count({ where: { companyId, isActive: true } }),
    ]);
    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, user: { select: { email: true } } },
    });
    const byKey = new Map(projects.map((p) => [p.key.toLowerCase(), p]));
    const byName = new Map(projects.map((p) => [p.name.trim().toLowerCase(), p]));
    const phaseByName = new Map(phases.map((p) => [p.name.trim().toLowerCase(), p.id]));
    const empLookup = (ref: string) => {
      const q = ref.trim().toLowerCase();
      return employees.find((e) =>
        e.user?.email?.toLowerCase() === q
        || (e.employeeCode && e.employeeCode.toLowerCase() === q)
        || `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim().toLowerCase() === q);
    };
    const existingIds = new Set(
      (await this.prisma.issue.findMany({
        where: { companyId, id: { in: rows.map((r) => Number(r['Task ID'])).filter((n) => Number.isInteger(n) && n > 0) } },
        select: { id: true, projectId: true },
      })).map((i) => `${i.id}:${i.projectId}`),
    );

    return rows.map((r, idx) => {
      const p: ParsedRow = {
        row: idx + 2, raw: r, sNo: String(r['S.No'] ?? '').trim(),
        projectLabel: String(r['Project Code'] || r['Project Name'] || '').trim(),
        title: String(r['Task Name'] ?? '').trim(),
        description: String(r['Task Description'] ?? '').trim() || null,
        prerequisites: String(r['Pre-Requisite'] ?? '').trim() || null,
        dependencyRefs: String(r['Dependency'] ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean),
        assigneeIds: [], errors: [], warnings: [],
      };

      // Project: code first (names repeat), else name; the board's own project when scoped.
      const code = String(r['Project Code'] ?? '').trim().toLowerCase();
      const name = String(r['Project Name'] ?? '').trim().toLowerCase();
      const project = (code && byKey.get(code)) || (name && byName.get(name))
        || (scopeProjectId && !code && !name ? projects[0] : undefined);
      if (!project) {
        p.errors.push(scopeProjectId
          ? 'Project does not match this board'
          : `Unknown project "${r['Project Code'] || r['Project Name'] || '(blank)'}"`);
      } else p.projectId = project.id;

      if (!p.title) p.errors.push('Task Name is required');

      const phaseText = String(r['Phase'] ?? '').trim();
      if (phaseText) {
        const id = phaseByName.get(phaseText.toLowerCase());
        if (!id) p.errors.push(`Unknown phase "${phaseText}"`); else p.phaseId = id;
      } else if (phasesExist && !r['Task ID']) {
        p.errors.push('Phase is required');
      }

      const hoursText = String(r['Assign Hours'] ?? '').trim();
      if (hoursText) {
        const h = Number(hoursText);
        if (!Number.isFinite(h) || h < 0) p.errors.push(`Assign Hours "${hoursText}" is not a number`);
        else p.hours = h;
      }

      p.startDate = this.parseDate(r['Start Date'], 'Start Date', p);
      p.dueDate = this.parseDate(r['End Date'], 'End Date', p);
      if (p.startDate && p.dueDate && p.dueDate < p.startDate) p.errors.push('End Date is before Start Date');

      if (project) {
        const onBoard = new Set([...(project.members || []).map((m) => m.employeeId), project.leadId].filter(Boolean) as number[]);
        const leads = new Set([
          ...(project.members || [])
            .filter((m) => m.role === PROJECT_ROLE.MANAGER || m.role === PROJECT_ROLE.ARCHITECT)
            .map((m) => m.employeeId),
          project.leadId,
        ].filter(Boolean) as number[]);

        for (const ref of String(r['Assign to'] ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
          const e = empLookup(ref);
          if (!e) p.errors.push(`Assign to: nobody called "${ref}"`);
          else if (!onBoard.has(e.id)) p.errors.push(`Assign to: ${e.firstName} ${e.lastName ?? ''} is not on this project`.trim());
          else p.assigneeIds.push(e.id);
        }

        const smeText = String(r['SME / Govern'] ?? '').trim();
        if (smeText) {
          const e = empLookup(smeText);
          if (!e) p.errors.push(`SME: nobody called "${smeText}"`);
          else if (!leads.has(e.id)) p.errors.push(`SME: ${e.firstName} ${e.lastName ?? ''} is not this project's PM or Technical Architect`.trim());
          else p.smeId = e.id;
        }

        const taskId = Number(r['Task ID']);
        if (r['Task ID'] !== '' && r['Task ID'] != null) {
          if (!Number.isInteger(taskId) || !existingIds.has(`${taskId}:${project.id}`)) {
            p.errors.push(`Task ID ${r['Task ID']} is not a task in this project`);
          } else p.taskId = taskId;
        }
      }
      return p;
    });
  }

  private summarise(parsed: ParsedRow[]) {
    const rows: ImportRowResult[] = parsed.map((r) => ({
      row: r.row, sNo: r.sNo, project: r.projectLabel, title: r.title,
      action: r.errors.length ? 'SKIP' : r.taskId ? 'UPDATE' : 'CREATE',
      ok: !r.errors.length, errors: r.errors, warnings: r.warnings,
      taskKey: (r as any).taskKey,
    }));
    return {
      total: rows.length,
      toCreate: rows.filter((r) => r.action === 'CREATE').length,
      toUpdate: rows.filter((r) => r.action === 'UPDATE').length,
      failed: rows.filter((r) => !r.ok).length,
      rows,
    };
  }

  private parseDate(v: any, label: string, p: ParsedRow): Date | null | undefined {
    if (v === '' || v == null) return undefined;
    if (v instanceof Date && !isNaN(v.getTime())) {
      return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    }
    if (typeof v === 'number') {
      const d = xlsx.SSF.parse_date_code(v);
      if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
    }
    const s = String(v).trim();
    // dd/mm/yyyy or dd-mm-yyyy (how people type dates here), else ISO.
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    const d = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : new Date(s);
    // Date.UTC rolls 31/31 over into a later month instead of failing; a date
    // that does not read back as what was typed is not that date.
    const rolled = m && (d.getUTCDate() !== +m[1] || d.getUTCMonth() !== +m[2] - 1);
    if (isNaN(d.getTime()) || rolled) { p.errors.push(`${label} "${s}" is not a date (use DD/MM/YYYY)`); return undefined; }
    return d;
  }

  private async findTaskByRef(companyId: number, projectId: number, ref: string) {
    const t = await this.prisma.issue.findFirst({
      where: {
        companyId, projectId,
        OR: [{ key: { equals: ref, mode: 'insensitive' } }, { title: { equals: ref, mode: 'insensitive' } }],
      },
      select: { id: true, projectId: true },
    });
    return t ?? null;
  }

  // ── Workbook helpers ─────────────────────────────────────────────────────

  private async referenceRows(companyId: number, projectIds: number[]) {
    const phases = await this.prisma.projectPhase.findMany({
      where: { companyId, isActive: true }, select: { name: true }, orderBy: { name: 'asc' },
    });
    const members = projectIds.length
      ? await this.prisma.projectMember.findMany({
          where: { projectId: { in: projectIds } },
          select: {
            role: true,
            project: { select: { key: true, name: true } },
            employee: { select: { firstName: true, lastName: true, employeeCode: true, user: { select: { email: true } } } },
          },
          orderBy: [{ projectId: 'asc' }],
        })
      : [];
    return [
      ['How to fill this file'],
      ['• One row per task. Project Code is preferred over Project Name (names repeat).'],
      ['• Dependency: S.No of another row in this file, or an existing task key/name. Several: 3, 5'],
      ['• Assign to: email (or employee code / full name) of people on that project. Several: comma-separated.'],
      ['• SME / Govern: email of the project\'s PM or Technical Architect.'],
      ['• Dates: DD/MM/YYYY. Keep the Task ID column from an export to update tasks instead of creating new ones.'],
      [],
      ['Phases'],
      ...phases.map((p) => [p.name]),
      [],
      ['Project Code', 'Project', 'Person', 'Email', 'Employee Code', 'Project Role'],
      ...members.map((m) => [
        m.project.key, m.project.name,
        `${m.employee.firstName ?? ''} ${m.employee.lastName ?? ''}`.trim(),
        m.employee.user?.email ?? '', m.employee.employeeCode ?? '', m.role,
      ]),
    ];
  }

  /**
   * A description for a spreadsheet cell: the board stores rich text (HTML,
   * sometimes with pasted images inlined as data: URLs), which is unreadable
   * in Excel and can blow past its 32,767-character cell limit.
   */
  private plainText(html?: string | null): string {
    if (!html) return '';
    return String(html)
      .replace(/<img[^>]*>/gi, ' [image] ')
      .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[image]')
      .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * The downloadable workbook, styled to be read by people: a coloured header
   * (template columns indigo, read-only export columns slate), frozen header
   * row, filters, zebra rows, wrapped text, status colours and a guide sheet.
   * Row 1 stays the header, so an exported file imports back unchanged.
   */
  private async workbook(main: any[][], reference?: any[][], sheetName = 'task'): Promise<Buffer> {
    const LIMIT = 32000; // Excel's cell limit is 32,767
    const wb = new ExcelJS.Workbook();
    wb.creator = 'MIRA';
    wb.created = new Date();

    const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1, xSplit: sheetName === 'task' ? 4 : 0 }] });
    const header = (main[0] || []).map(String);
    const readOnly = new Set<string>([...EXTRA_COLUMNS, 'Errors']);
    const widthFor = (h: string) =>
      /Description|Pre-Requisite|Errors/.test(h) ? 46
      : /Task Name|^Task$/.test(h) ? 44
      : /Week|Assigned to/.test(h) ? 24
      : /Project Name|Assign to|SME/.test(h) ? 28
      : /Dependency|Phase/.test(h) ? 20
      : /S\.No/.test(h) ? 7
      : 15;
    ws.columns = header.map((h) => ({ header: h, key: h, width: widthFor(h) }));

    const border: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };

    const head = ws.getRow(1);
    head.height = 30;
    head.eachCell((cell, col) => {
      const ro = readOnly.has(header[col - 1]);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ro ? 'FF475569' : 'FF4338CA' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = border;
    });

    const statusFill: Record<string, string> = {
      DONE: 'FFDCFCE7', CLOSED: 'FFDCFCE7', IN_PROGRESS: 'FFDBEAFE', IN_REVIEW: 'FFEDE9FE',
      REVIEW: 'FFEDE9FE', TODO: 'FFF1F5F9', BLOCKED: 'FFFEE2E2',
    };
    const statusFont: Record<string, string> = {
      DONE: 'FF166534', CLOSED: 'FF166534', IN_PROGRESS: 'FF1D4ED8', IN_REVIEW: 'FF6D28D9',
      REVIEW: 'FF6D28D9', TODO: 'FF475569', BLOCKED: 'FFB91C1C',
    };
    const statusCol = header.indexOf('Status') + 1;
    const errorsCol = header.indexOf('Errors') + 1;

    main.slice(1).forEach((values, i) => {
      const row = ws.addRow(values.map((v) =>
        typeof v === 'string' && v.length > LIMIT ? v.slice(0, LIMIT) + ' …[truncated]' : v));
      row.height = 22;
      const zebra = i % 2 === 1;
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > header.length) return;
        cell.border = border;
        cell.alignment = { vertical: 'top', wrapText: true,
          horizontal: /S\.No|Assign Hours|Task ID|Logged Hours|Date/.test(header[col - 1]) ? 'center' : 'left' };
        cell.font = { size: 10.5, name: 'Calibri', color: { argb: 'FF0F172A' } };
        if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
      if (statusCol > 0) {
        const c = row.getCell(statusCol);
        const k = String(c.value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
        if (statusFill[k]) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusFill[k] } };
          c.font = { bold: true, size: 10, color: { argb: statusFont[k] } };
          c.alignment = { vertical: 'top', horizontal: 'center' };
        }
      }
      if (errorsCol > 0) {
        const c = row.getCell(errorsCol);
        c.font = { size: 10.5, color: { argb: 'FFB91C1C' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
      }
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };

    if (reference) {
      const rs = wb.addWorksheet('Valid values', { views: [{ showGridLines: false }] });
      rs.columns = [{ width: 18 }, { width: 34 }, { width: 26 }, { width: 32 }, { width: 15 }, { width: 22 }];
      for (const r of reference) {
        const row = rs.addRow(r);
        const first = String(r[0] ?? '');
        if (r.length === 1 && /^(How to fill this file|Phases)$/.test(first)) {
          row.font = { bold: true, size: 13, color: { argb: 'FF4338CA' } };
          row.height = 24;
        } else if (r.length > 1 && first === 'Project Code') {
          row.eachCell((c) => {
            c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
            c.border = border;
          });
        } else if (r.length > 1) {
          row.eachCell((c) => { c.border = border; c.font = { size: 10.5 }; });
        } else if (first.startsWith('•')) {
          row.font = { size: 10.5, color: { argb: 'FF334155' } };
          rs.mergeCells(row.number, 1, row.number, 6);
        }
      }
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /**
   * Any table the client has already built (e.g. the roadmap), in the same
   * styled workbook as task exports. Rows are text the caller could already
   * see; nothing is read from the database here.
   */
  async styledTable(sheetName: string, headers: string[], rows: any[][]): Promise<Buffer> {
    const clean = (sheetName || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    return this.workbook([headers, ...rows.slice(0, 20000)], undefined, clean);
  }

  private day(d?: Date | null): string {
    if (!d) return '';
    const x = new Date(d);
    return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`;
  }
}
