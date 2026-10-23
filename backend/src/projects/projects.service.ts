import { DEFAULT_BOARD_COLUMNS } from './boards/default-board-columns';
import { Logger, Injectable, BadRequestException, NotFoundException, ForbiddenException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { applyFinancialVisibilityAll } from './project-visibility';
import { buildInitialMembers } from './project-members';
import { renameKeepingExtension, InvalidDocumentName } from './document-naming';
import { CrmService } from '../crm/crm.service';
import * as path from 'path';
import * as crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
const pdfParse = require('pdf-parse');
import * as mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import { resolveProjectViewer, taskVisibilityFilter, seesProjectFinancials, PROJECT_ROLE, hasCompanyWideProjectAccess } from './project-roles';
import { isCompanyAdmin } from '../common/company-roles';
import { normaliseSubCode, subprojectKey, normaliseBudgetMode, rollUpBudget } from './subproject-rules';

/**
 * Working hours in a month for pricing time from salary when an employee has
 * no hourly cost rate: 26 days x 9 hours (company standard, 19 Oct 2026).
 */
export const STANDARD_MONTH_HOURS = 234;

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  constructor(
    private prisma: PrismaService,
    private crm: CrmService,
  ) {}

  /** The caller's most recently started timer that has not yet been closed. */
  async getMyActiveTimer(companyId: number, userId: number) {
    const employee = await this.prisma.employee.findFirst({ where: { companyId, userId }, select: { id: true } });
    if (!employee) return null;
    const log = await this.prisma.issueTimeLog.findFirst({
      where: { employeeId: employee.id, endedAt: null, issue: { companyId } },
      orderBy: { startedAt: 'desc' },
      select: {
        startedAt: true,
        issue: { select: { id: true, key: true, title: true, projectId: true } },
      },
    });
    return log ? { projectId: log.issue.projectId, issueId: log.issue.id, taskKey: log.issue.key, taskTitle: log.issue.title, startedAt: log.startedAt } : null;
  }

  /**
   * The Client id a project should be saved against (§4).
   *
   * The form picks a LEAD CONTACT, not a client — that is who the business
   * actually knows at the point a project is created. Project.clientId still
   * points at Client, so every client filter, column and future invoice is
   * unaffected; this is the step that turns the chosen contact into that row,
   * reusing an existing client of the same name rather than duplicating it.
   *
   * `clientId` is still honoured when sent directly, so anything already
   * passing a client (imports, the AI onboarding flow) keeps working.
   */
  private async resolveClientId(companyId: number, data: any): Promise<number | null | undefined> {
    if (data.leadContactId) {
      const client = await this.crm.findOrCreateClientFromLeadContact(
        companyId,
        parseInt(data.leadContactId, 10),
      );
      return client.id;
    }
    // Explicitly cleared, versus simply not mentioned in the payload.
    if (data.leadContactId === null && data.clientId === undefined) return null;
    if (data.clientId !== undefined) return data.clientId ? parseInt(data.clientId, 10) : null;
    return undefined;
  }

  /**
   * Fields a NEW project cannot be created without.
   *
   * Enforced on create only, deliberately. When this rule was introduced 82 of
   * 83 existing projects had no department — it had been added a phase earlier
   * and never backfilled — so applying it to updates would have made almost
   * every project in the system unsaveable until somebody guessed a department
   * for it. New projects start complete; old ones are fixed deliberately
   * rather than by being held hostage to an unrelated edit.
   *
   * Server-side because the form is not the only caller, and a required field
   * that only the UI knows about is a suggestion rather than a rule.
   */
  private assertRequiredForCreate(data: any) {
    const missing: string[] = [];

    if (!data.name?.trim()) missing.push('Board title');
    if (!data.startDate) missing.push('Start date');
    if (!data.endDate) missing.push('Deadline');
    if (!data.departmentId) missing.push('Department');
    if (!data.category?.trim()) missing.push('Category');
    if (!Array.isArray(data.pmIds) || data.pmIds.length === 0) {
      missing.push('At least one project manager');
    }
    if (!Array.isArray(data.memberIds) || data.memberIds.length === 0) {
      missing.push('At least one assigned user');
    }

    if (missing.length) {
      throw new BadRequestException(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`);
    }

    // A deadline before the start is not a missing field but it is not a
    // project either, and the two are worth reporting separately.
    if (new Date(data.endDate) < new Date(data.startDate)) {
      throw new BadRequestException('Deadline must be on or after the start date');
    }
  }

  async createProject(companyId: number, leadId: number, data: any) {
    this.assertRequiredForCreate(data);

    // Ensure unique project name per company (case-insensitive)
    const existingProject = await this.prisma.project.findFirst({
      where: { companyId, name: { equals: data.name.trim(), mode: 'insensitive' } }
    });
    if (existingProject) {
      throw new BadRequestException(`Project with name "${data.name}" already exists`);
    }

    // Generate new project code format: CES/MMYY/SEQ (e.g., CES/0626/01)
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const baseKey = `CES/${mm}${yy}/`;

    // Find the highest sequence number for this month
    const existingProjects = await this.prisma.project.findMany({
      where: {
        companyId,
        key: { startsWith: baseKey }
      },
      select: { key: true }
    });

    let maxSeq = 0;
    for (const proj of existingProjects) {
      const parts = proj.key.split('/');
      if (parts.length === 3) {
        const seqNum = parseInt(parts[2], 10);
        if (!isNaN(seqNum) && seqNum > maxSeq) {
          maxSeq = seqNum;
        }
      }
    }

    const nextSeq = String(maxSeq + 1).padStart(2, '0');
    // A subproject's code is not sequenced: it is its parent's code and its own
    // sub code, worked out (and checked free) by createSubproject.
    const sub = data.__subproject as { parentId: number; subCode: string; key: string } | undefined;
    const finalKey = sub?.key ?? `${baseKey}${nextSeq}`;

    // The form sends a lead contact; this is the Client it resolves to.
    const resolvedClientId = await this.resolveClientId(companyId, data);

    // Create project, member, and default board
    const project = await this.prisma.project.create({
      data: {
        name: data.name,
        key: finalKey,
        description: data.description,
        // §1: the short statement of what the project is.
        summary: data.summary ?? null,
        color: data.color || '#2563eb',
        icon: data.icon || 'folder',
        address: data.address ?? null,
        onsiteRepresentation: data.onsiteRepresentation?.trim() || null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        billingType: data.billingType || 'NON_BILLABLE',
        budgetAmount: data.budgetAmount ? parseFloat(data.budgetAmount) : null,
        hourlyRate: data.hourlyRate ? parseFloat(data.hourlyRate) : null,
        clientId: resolvedClientId ?? null,
        // What was actually chosen, so an edit can show it again.
        leadContactId: data.leadContactId ? parseInt(data.leadContactId, 10) : null,
        // Delivery module fields (§4, §7, §9). A project created without a
        // status is ACTIVE rather than DRAFT: somebody filling in this form is
        // starting work, and DRAFT would hide it behind the default filter.
        category: data.category || null,
        priority: data.priority || 'MEDIUM',
        departmentId: data.departmentId ? parseInt(data.departmentId, 10) : null,
        workStatus: data.workStatus || 'ACTIVE',
        currency: data.currency || 'INR',
        budgetNotes: data.budgetNotes || null,
        estimatedHours: data.estimatedHours ? parseFloat(data.estimatedHours) : null,
        allowManualTimeLogging: data.allowManualTimeLogging === undefined ? true : !!data.allowManualTimeLogging,
        ...(sub ? { parentId: sub.parentId, subCode: sub.subCode } : {}),
        companyId,
        leadId,
        members: {
          // One row per person, highest role wins. The owner is ADMIN, the
          // chosen managers are PROJECT_MANAGER, and everyone else assigned to
          // the project is MEMBER — de-duplicated, because ProjectMember is
          // unique on (projectId, employeeId) and somebody picked as both a
          // manager and a user would otherwise fail the insert.
          create: buildInitialMembers(leadId, data.pmIds, data.memberIds, (data as any).architectIds, (data as any).coordinatorIds, (data as any).leadEngineerIds)
        },
        boards: {
          create: { name: 'Main Board', columns: { create: DEFAULT_BOARD_COLUMNS } }
        }
      }
    });

    await this.seedDefaultProjectTasks(companyId, project, leadId, data);

    return project;
  }

  /**
   * The tasks every project starts with, assigned to its project manager (§1).
   *
   * Created outside the normal task flow on purpose: this runs before anybody
   * has opened the project, so there is no actor to check permissions against
   * and no board interaction to react to. It writes the rows directly rather
   * than going through IssuesService, which would refuse them -- the creator
   * is not necessarily somebody who may raise work in a project that did not
   * exist a moment ago.
   *
   * Never fatal. A project that exists without its checklist is a nuisance; a
   * project creation that fails after the project row is committed is a
   * broken half-project the user cannot retry.
   */
  private async seedDefaultProjectTasks(
    companyId: number,
    project: { id: number; key: string },
    leadId: number,
    data: any,
  ) {
    try {
      const defaults = await this.prisma.defaultProjectTask.findMany({
        where: { companyId, isActive: true },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      });
      if (!defaults.length) return;

      // The PM these belong to: the first project manager named on the form,
      // falling back to the lead. "Assigned to the PM" has to resolve to
      // somebody, and the lead is who answers for the project when no
      // separate manager was chosen.
      const pmIds = Array.isArray(data?.pmIds)
        ? data.pmIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
        : [];
      const assigneeId = pmIds[0] ?? leadId;

      const todo = await this.prisma.boardColumn.findFirst({
        where: { board: { projectId: project.id }, type: 'TODO' },
        orderBy: { position: 'asc' },
        select: { id: true },
      });

      /**
       * Number from whatever the project already holds, not from one.
       *
       * On a brand-new project that is zero. At AI-wizard kickoff it is not:
       * the analysis has just written its own tasks numbered from one, and
       * starting again would collide on @@unique([key, companyId]) and take
       * the whole kickoff down with it.
       *
       * The row count is not the whole story either. Deleted tasks shrink it
       * below the highest number ever handed out, so a task created and then
       * removed would leave `count` lower than `issueSeq` -- and numbering
       * the defaults from the count would hand the deleted task's number to a
       * new one, or advance issueSeq backwards and let the next manual task
       * collide with one already on the board. Taking the higher of the two
       * keeps every number issued so far safe.
       */
      const [existing, seqRow] = await Promise.all([
        this.prisma.issue.count({
          where: { projectId: project.id, companyId },
        }),
        this.prisma.project.findUnique({
          where: { id: project.id },
          select: { issueSeq: true },
        }),
      ]);
      const base = Math.max(existing, seqRow?.issueSeq ?? 0);

      await this.prisma.issue.createMany({
        data: defaults.map((t, index) => ({
          key: `${project.key}-${base + index + 1}`,
          title: t.name,
          description: t.description,
          type: 'TASK',
          status: 'TODO',
          priority: 'MEDIUM',
          projectId: project.id,
          companyId,
          columnId: todo?.id ?? null,
          assigneeId,
          reporterId: leadId,
          position: base + index,
        })),
      });

      /**
       * Also record the PM as a member, not only as the assignee.
       *
       * The unified task form writes both, so without this a default task is
       * subtly unlike every other task: the board card still shows the face,
       * because it renders the assignee first, but anything reading the member
       * list alone sees nobody on it.
       *
       * createMany returns no ids, so the rows are read back by the keys just
       * written -- they are unique per company and nothing else can hold them.
       */
      if (assigneeId) {
        const created = await this.prisma.issue.findMany({
          where: {
            projectId: project.id,
            key: { in: defaults.map((_, i) => `${project.key}-${base + i + 1}`) },
          },
          select: { id: true },
        });
        await this.prisma.issueMember.createMany({
          data: created.map((i) => ({ issueId: i.id, employeeId: assigneeId })),
          skipDuplicates: true,
        });
      }

      // issueSeq must know about them, or the first task somebody raises by
      // hand collides with one of these on @@unique([key, companyId]).
      await this.prisma.project.update({
        where: { id: project.id },
        data: { issueSeq: base + defaults.length },
      });
    } catch (err) {
      this.logger.error(
        `Default project tasks could not be created for project ${project.id}: ${err}`,
      );
    }
  }

  /**
   * Next company project code: CES/MMYY/SEQ (e.g., CES/0626/01).
   *
   * Same sequence rule as createProject / createAiProject — highest sequence
   * for the current month plus one, zero-padded to two digits — shared so a
   * duplicate can never collide with the @@unique([key, companyId]) on the
   * source project, and so every writer agrees on what "next" means.
   */
  private async nextProjectKey(companyId: number): Promise<string> {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const baseKey = `CES/${mm}${yy}/`;

    const existingProjects = await this.prisma.project.findMany({
      where: { companyId, key: { startsWith: baseKey } },
      select: { key: true },
    });

    let maxSeq = 0;
    for (const proj of existingProjects) {
      const parts = proj.key.split('/');
      if (parts.length === 3) {
        const seqNum = parseInt(parts[2], 10);
        if (!isNaN(seqNum) && seqNum > maxSeq) {
          maxSeq = seqNum;
        }
      }
    }

    return `${baseKey}${String(maxSeq + 1).padStart(2, '0')}`;
  }

  /**
   * Duplicate a project — "create a new project using the existing one as a
   * blueprint", not "clone every row".
   *
   * Copies blueprint data (details, members, milestone structure, task
   * structure, assignments, dependencies, project and task files) while
   * deliberately NOT copying anything that is evidence of past work:
   * timestamps, IDs, activity, comments, time logs, timesheets, tickets,
   * budget requests, notifications/reminders, financial records or the
   * AI analysis runs. Task/milestone/project status and progress are reset.
   *
   * Every id on the copy is freshly generated and every relationship is
   * remapped to the new rows (milestones, columns, parents, dependencies,
   * labels), never pointing at the source project.
   */
  async duplicateProject(
    companyId: number,
    actorEmployeeId: number,
    role: string,
    sourceProjectId: number,
    data: any,
  ) {
    const copy = {
      // Project identity: the board layout, the content built on it. All
      // default true — the blueprint keeps its structure.
      summary: data?.copy?.summary ?? true,
      boards: data?.copy?.boards ?? true,
      members: data?.copy?.members ?? true,
      milestones: data?.copy?.milestones ?? true,
      tasks: data?.copy?.tasks ?? true,
      taskAssignments: data?.copy?.taskAssignments ?? true,
      taskDependencies: data?.copy?.taskDependencies ?? true,
      // Attachments are the project-level documents, evidence the files on the
      // tasks. Older callers used projectFiles/taskFiles for the same things.
      projectFiles: data?.copy?.projectFiles ?? data?.copy?.attachments ?? true,
      evidence: data?.copy?.evidence ?? data?.copy?.taskFiles ?? true,
      taskFiles: data?.copy?.taskFiles ?? data?.copy?.evidence ?? true,
      labels: data?.copy?.labels ?? true,
      // Historical or operational records stay behind by default: the copy is
      // a fresh blueprint, and each of these carries approvals, timestamps or
      // attachments from a project that already happened.
      comments: data?.copy?.comments ?? false,
      activity: data?.copy?.activity ?? false,
      timeLogs: data?.copy?.timeLogs ?? false,
      clientVisits: data?.copy?.clientVisits ?? false,
      tickets: data?.copy?.tickets ?? false,
      discussions: data?.copy?.discussions ?? false,
      budgetRequests: data?.copy?.budgetRequests ?? false,
    };

    const name = data?.name?.trim();
    if (!name) throw new BadRequestException('Project name is required');

    const dateMode = data?.dateMode || 'KEEP';
    if (!['KEEP', 'SHIFT', 'RESET'].includes(dateMode)) {
      throw new BadRequestException('Invalid date mode');
    }

    const existing = await this.prisma.project.findFirst({
      where: { companyId, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new BadRequestException(`Project with name "${name}" already exists`);
    }

    const source = await this.prisma.project.findUnique({
      where: { id: sourceProjectId },
      include: {
        members: true,
        boards: { include: { columns: { orderBy: { position: 'asc' } } } },
        labels: { orderBy: { id: 'asc' } },
        milestones: { orderBy: { position: 'asc' } },
        documents: true,
        fieldVisits: { include: { photos: true } },
        discussions: { include: { comments: true, attachments: true } },
        projectTickets: true,
        budgetRequests: true,
        issues: {
          where: { isArchived: false },
          include: {
            comments: true,
            attachments: true,
            labels: true,
            members: true,
            activities: true,
            timeLogs: true,
            blockedBy: true,
            checklists: { include: { items: true } },
          },
        },
      },
    });
    if (!source || source.companyId !== companyId) {
      throw new NotFoundException('Project not found');
    }

    // Duplicating a project is a super-admin-only action — it effectively
    // forks the workspace, so the capability must not leak down to admins.
    if (role !== 'SUPERADMIN') {
      throw new ForbiddenException('Only a super administrator can duplicate a project');
    }

    // Members, assignees and authors must still be active and in the same
    // workspace. Anyone separated or belonging to another company is dropped
    // rather than copied into a project they can no longer see.
    const candidateIds = new Set<number>([actorEmployeeId]);
    if (source.leadId) candidateIds.add(source.leadId);
    // The duplicate modal lets the supervisor rework the team, so ids picked
    // there must be admitted even when they were not on the source project.
    for (const id of [...(data?.pmIds ?? []), ...(data?.memberIds ?? [])]) {
      const n = Number(id);
      if (Number.isInteger(n) && n > 0) candidateIds.add(n);
    }
    for (const m of source.members) candidateIds.add(m.employeeId);
    for (const i of source.issues) {
      if (i.assigneeId) candidateIds.add(i.assigneeId);
      if (i.reporterId) candidateIds.add(i.reporterId);
      for (const t of i.timeLogs) candidateIds.add(t.employeeId);
      for (const a of i.activities) candidateIds.add(a.actorId);
      for (const c of i.comments) candidateIds.add(c.authorId);
      for (const at of i.attachments) candidateIds.add(at.uploadedBy);
      for (const m of i.members) candidateIds.add(m.employeeId);
    }
    for (const d of source.documents) candidateIds.add(d.uploadedBy);
    for (const m of source.milestones) if (m.ownerId) candidateIds.add(m.ownerId);
    for (const v of source.fieldVisits) candidateIds.add(v.employeeId);
    for (const disc of source.discussions) {
      candidateIds.add(disc.authorId);
      for (const c of disc.comments) candidateIds.add(c.authorId);
      for (const a of disc.attachments) candidateIds.add(a.uploadedById);
    }
    for (const t of source.projectTickets) {
      candidateIds.add(t.raisedById);
      if (t.proposedAssigneeId) candidateIds.add(t.proposedAssigneeId);
    }
    for (const r of source.budgetRequests) {
      candidateIds.add(r.requestedById);
      if (r.reviewedById) candidateIds.add(r.reviewedById);
    }

    const activeEmployees = await this.prisma.employee.findMany({
      where: {
        companyId,
        id: { in: Array.from(candidateIds) },
        offboardingStatus: { not: 'SEPARATED' },
      },
      select: { id: true },
    });
    const activeIds = new Set(activeEmployees.map((e) => e.id));

    // Dates: KEEP copies them, SHIFT moves everything by the same amount so
    // the duplicate starts on the requested date, RESET blanks all of them.
    // The modal edits the start/end date fields directly and sends those as
    // `startDate`/`endDate`; dateMode then only decides what happens to the
    // date-carrying content (issues, milestones). `shiftStartDate` is kept for
    // older callers that still express a shift as a single target date.
    let dateOffsetMs = 0;
    const rawStart =
      data?.startDate != null && data?.startDate !== '' ? new Date(data.startDate) : null;
    const rawEnd =
      data?.endDate != null && data?.endDate !== '' ? new Date(data.endDate) : null;
    const requestedStart =
      rawStart ??
      (dateMode === 'SHIFT' && data.shiftStartDate ? new Date(data.shiftStartDate) : null);
    if ((dateMode === 'SHIFT' || rawStart) && requestedStart && source.startDate) {
      dateOffsetMs = requestedStart.getTime() - source.startDate.getTime();
    }
    const applyDate = (value: Date | null): Date | null => {
      if (!value) return null;
      if (dateMode === 'RESET') return null;
      if (dateMode === 'KEEP') return new Date(value);
      return new Date(value.getTime() + dateOffsetMs);
    };
    const projectStart = rawStart
      ?? (dateMode === 'SHIFT'
        ? (requestedStart ?? applyDate(source.startDate))
        : applyDate(source.startDate));
    const projectEnd = rawEnd ?? applyDate(source.endDate);

    // Editable identity fields. Every create-form field is optional here;
    // anything absent is taken straight from the source project.
    const ov = data?.overrides ?? {};
    const pick = <T>(key: string, fallback: T): T => (ov[key] !== undefined ? ov[key] : fallback);

    const key = await this.nextProjectKey(companyId);

    const duplicated = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name,
          key,
          description: copy.summary ? pick('description', source.description) : null,
          summary: copy.summary ? pick('summary', source.summary) : null,
          color: pick('color', source.color),
          icon: source.icon,
          address: pick('address', source.address),
          startDate: projectStart,
          endDate: projectEnd,
          billingType: pick('billingType', source.billingType),
          budgetAmount: pick('budgetAmount', source.budgetAmount),
          hourlyRate: pick('hourlyRate', source.hourlyRate),
          clientId: source.clientId,
          leadContactId: pick('leadContactId', source.leadContactId),
          category: pick('category', source.category),
          priority: pick('priority', source.priority),
          departmentId: pick('departmentId', source.departmentId),
          // Reset to the app's default active lifecycle state — a blueprint
          // of a completed project must not come into existence completed.
          // The duplicate modal can still choose a different status.
          workStatus: pick('workStatus', 'ACTIVE'),
          closureStatus: 'WORK_PENDING',
          onboardingStatus: 'DRAFT',
          progress: null,
          issueSeq: 0,
          currency: pick('currency', source.currency),
          budgetNotes: pick('budgetNotes', source.budgetNotes),
          estimatedHours: pick('estimatedHours', source.estimatedHours),
          allowManualTimeLogging: pick('allowManualTimeLogging', source.allowManualTimeLogging),
          companyId,
          leadId: source.leadId && activeIds.has(source.leadId) ? source.leadId : actorEmployeeId,
        },
      });

      // ── Members ────────────────────────────────────────────────────────
      // Without pmIds/memberIds the blueprint's team is copied as-is (the
      // original behaviour). When the modal provides them they replace the
      // team entirely, exactly like the create form: PMs take PROJECT_MANAGER,
      // everyone else MEMBER, and whoever leads is always ADMIN.
      if (copy.members) {
        const roleByEmployee = new Map<number, string>();
        if (data?.pmIds != null && data?.memberIds != null) {
          // leadId is always a number here: it falls back to actorEmployeeId
          // when the source lead is gone.
          for (const row of buildInitialMembers(project.leadId!, data.pmIds, data.memberIds, (data as any).architectIds)) {
            if (activeIds.has(row.employeeId)) roleByEmployee.set(row.employeeId, row.role);
          }
        } else {
          for (const m of source.members) {
            if (activeIds.has(m.employeeId)) roleByEmployee.set(m.employeeId, m.role);
          }
          // Whoever leads the duplicate is always an ADMIN on it, mirroring how
          // buildInitialMembers treats the lead of a fresh project.
          if (project.leadId) roleByEmployee.set(project.leadId, 'ADMIN');
        }
        await tx.projectMember.createMany({
          data: Array.from(roleByEmployee, ([employeeId, mRole]) => ({
            projectId: project.id,
            employeeId,
            role: mRole,
          })),
        });
      }

      // ── Boards & columns (Board / List layout) ─────────────────────────────
      const columnMap = new Map<number, number>();
      let firstColumnId: number | null = null;
      if (copy.boards) {
        for (const board of source.boards) {
          const created = await tx.board.create({
            data: {
              name: board.name,
              projectId: project.id,
              columns: {
                create: board.columns.map((c) => ({
                  name: c.name,
                  type: c.type,
                  color: c.color,
                  position: c.position,
                  isSystem: c.isSystem,
                  isArchived: c.isArchived,
                })),
              },
            },
            include: { columns: true },
          });
          board.columns.forEach((c, i) => {
            columnMap.set(c.id, created.columns[i].id);
            if (firstColumnId === null) firstColumnId = created.columns[i].id;
          });
        }
      }

      // Every project needs a board: without one the Board tab 404s and the
      // copied tasks have no column. Boards not copied (or none on the
      // source) get the standard one, and the copied tasks start in To Do.
      if (firstColumnId === null) {
        const fresh = await tx.board.create({
          data: { name: 'Main Board', projectId: project.id, columns: { create: DEFAULT_BOARD_COLUMNS } },
          include: { columns: { orderBy: { position: 'asc' } } },
        });
        firstColumnId = fresh.columns[0].id;
      }

      // ── Labels (project tags) ───────────────────────────────────────────
      const labelMap = new Map<number, number>();
      if (copy.labels) {
        for (const label of source.labels) {
          const created = await tx.label.create({
            data: { name: label.name, color: label.color, projectId: project.id },
          });
          labelMap.set(label.id, created.id);
        }
      }

      // ── Milestones ──────────────────────────────────────────────────────
      const milestoneMap = new Map<number, number>();
      if (copy.milestones) {
        for (const m of source.milestones) {
          const created = await tx.projectMilestone.create({
            data: {
              projectId: project.id,
              companyId,
              name: m.name,
              description: m.description,
              startDate: applyDate(m.startDate),
              dueDate: applyDate(m.dueDate),
              percentage: m.percentage,
              amount: m.amount,
              // Structure is blueprint; completion is history.
              status: 'PENDING',
              completedAt: null,
              ownerId: m.ownerId && activeIds.has(m.ownerId) ? m.ownerId : null,
              position: m.position,
            },
          });
          milestoneMap.set(m.id, created.id);
        }
      }

      // ── Tasks & subtasks (Issues) ───────────────────────────────────────
      let seq = 0;
      // Kept in scope beyond the tasks block so a converted project ticket can
      // point its convertedIssueId at the duplicated task it became.
      const issueMap = new Map<number, number>();
      const createdIssues: { source: any; created: any }[] = [];

      if (copy.tasks) {
        for (const issue of [...source.issues].sort((a, b) => a.id - b.id)) {
          const created = await tx.issue.create({
            data: {
              key: `${project.key}-${++seq}`,
              title: issue.title,
              description: issue.description,
              type: issue.type,
              // Prefer resetting to the initial status: the copy is a fresh
              // project, work is not already finished on it.
              status: 'TODO',
              priority: issue.priority,
              storyPoints: issue.storyPoints,
              startDate: applyDate(issue.startDate),
              dueDate: applyDate(issue.dueDate),
              estimatedHours: issue.estimatedHours,
              recurring: issue.recurring,
              coverUrl: issue.coverUrl,
              position: issue.position,
              projectId: project.id,
              companyId,
              leadId: issue.leadId,
              taskTypeId: issue.taskTypeId,
              phaseId: issue.phaseId,
              milestoneId:
                copy.milestones && issue.milestoneId != null
                  ? (milestoneMap.get(issue.milestoneId) ?? null)
                  : null,
              columnId: issue.columnId != null ? (columnMap.get(issue.columnId) ?? firstColumnId) : firstColumnId,
              assigneeId:
                copy.taskAssignments && issue.assigneeId && activeIds.has(issue.assigneeId)
                  ? issue.assigneeId
                  : null,
              reporterId: issue.reporterId && activeIds.has(issue.reporterId) ? issue.reporterId : actorEmployeeId,
              additionalHours: 0,
            },
          });
          issueMap.set(issue.id, created.id);
          createdIssues.push({ source: issue, created });
        }

        // Subtasks & epic hierarchy (parents first, remapped to the new rows).
        for (const { source: issue, created } of createdIssues) {
          if (issue.parentId != null && issueMap.has(issue.parentId)) {
            await tx.issue.update({
              where: { id: created.id },
              data: { parentId: issueMap.get(issue.parentId)! },
            });
          }
        }

        // Checklists — items copied but completion reset, so the duplicate
        // reads as fresh work rather than work already done.
        for (const { source: issue, created } of createdIssues) {
          for (const checklist of issue.checklists) {
            await tx.checklist.create({
              data: {
                title: checklist.title,
                issueId: created.id,
                items: {
                  create: checklist.items.map((item: any) => ({
                    title: item.title,
                    isCompleted: false,
                  })),
                },
              },
            });
          }
        }

        // Task members (assignments).
        if (copy.taskAssignments) {
          const rows: { issueId: number; employeeId: number }[] = [];
          for (const { source: issue, created } of createdIssues) {
            for (const member of issue.members) {
              if (activeIds.has(member.employeeId)) {
                rows.push({ issueId: created.id, employeeId: member.employeeId });
              }
            }
          }
          if (rows.length) await tx.issueMember.createMany({ data: rows, skipDuplicates: true });
        }

        // Task labels, remapped to the duplicate's own labels.
        if (copy.labels) {
          const rows: { issueId: number; labelId: number }[] = [];
          for (const { source: issue, created } of createdIssues) {
            for (const issueLabel of issue.labels) {
              const labelId = labelMap.get(issueLabel.labelId);
              if (labelId != null) rows.push({ issueId: created.id, labelId });
            }
          }
          if (rows.length) await tx.issueLabel.createMany({ data: rows, skipDuplicates: true });
        }

        // Dependencies — both ends remapped to the duplicated tasks.
        if (copy.taskDependencies) {
          const rows: any[] = [];
          for (const { source: issue } of createdIssues) {
            const newIssueId = issueMap.get(issue.id)!;
            for (const dependency of issue.blockedBy) {
              const dependsOnNewId = issueMap.get(dependency.dependsOnIssueId);
              if (dependsOnNewId != null) {
                rows.push({
                  issueId: newIssueId,
                  dependsOnIssueId: dependsOnNewId,
                  type: dependency.type || 'BLOCKS',
                  companyId,
                  createdById: actorEmployeeId,
                });
              }
            }
          }
          if (rows.length) await tx.issueDependency.createMany({ data: rows, skipDuplicates: true });
        }

        // Task files — the Evidence tab: files attached to tasks. The storage
        // reference (ImageKit URL) is reusable.
        if (copy.evidence) {
          const rows: any[] = [];
          for (const { source: issue, created } of createdIssues) {
            for (const attachment of issue.attachments) {
              rows.push({
                issueId: created.id,
                fileName: attachment.fileName,
                fileUrl: attachment.fileUrl,
                fileSize: attachment.fileSize,
                fileType: attachment.fileType,
                isCover: attachment.isCover,
                uploadedBy:
                  attachment.uploadedBy && activeIds.has(attachment.uploadedBy)
                    ? attachment.uploadedBy
                    : actorEmployeeId,
              });
            }
          }
          if (rows.length) await tx.issueAttachment.createMany({ data: rows });
        }

        // Historical conversation — opt-in only.
        if (copy.comments) {
          const rows: { issueId: number; body: string; authorId: number }[] = [];
          for (const { source: issue, created } of createdIssues) {
            for (const comment of issue.comments) {
              rows.push({
                issueId: created.id,
                body: comment.body,
                authorId: comment.authorId && activeIds.has(comment.authorId) ? comment.authorId : actorEmployeeId,
              });
            }
          }
          if (rows.length) await tx.issueComment.createMany({ data: rows });
        }

        // Activity history — opt-in only.
        if (copy.activity) {
          const rows: any[] = [];
          for (const { source: issue, created } of createdIssues) {
            for (const activity of issue.activities) {
              rows.push({
                issueId: created.id,
                action: activity.action,
                field: activity.field,
                oldValue: activity.oldValue,
                newValue: activity.newValue,
                actorId: activity.actorId && activeIds.has(activity.actorId) ? activity.actorId : actorEmployeeId,
              });
            }
          }
          if (rows.length) await tx.issueActivity.createMany({ data: rows });
        }

        // Time logs — opt-in only; the duplicate starts at zero hours by default.
        if (copy.timeLogs) {
          const rows: any[] = [];
          for (const { source: issue, created } of createdIssues) {
            for (const log of issue.timeLogs) {
              rows.push({
                issueId: created.id,
                employeeId: log.employeeId && activeIds.has(log.employeeId) ? log.employeeId : actorEmployeeId,
                startedAt: log.startedAt,
                endedAt: log.endedAt,
                durationMin: log.durationMin,
                source: log.source,
                note: log.note,
              });
            }
          }
          if (rows.length) await tx.issueTimeLog.createMany({ data: rows });
        }
      }

      // ── Project-level files ─────────────────────────────────────────────
      if (copy.projectFiles && source.documents.length) {
        await tx.projectDocument.createMany({
          data: source.documents.map((doc: any) => ({
            projectId: project.id,
            name: doc.name,
            url: doc.url,
            fileId: doc.fileId,
            type: doc.type,
            rawText: doc.rawText,
            status: doc.status,
            uploadedBy: doc.uploadedBy && activeIds.has(doc.uploadedBy) ? doc.uploadedBy : actorEmployeeId,
          })),
        });
      }

      // ── Client visits (FieldVisit + photos) — opt-in ────────────────────
      if (copy.clientVisits && source.fieldVisits.length) {
        for (const visit of source.fieldVisits) {
          await tx.fieldVisit.create({
            data: {
              projectId: project.id,
              companyId,
              employeeId: activeIds.has(visit.employeeId) ? visit.employeeId : actorEmployeeId,
              startTime: visit.startTime,
              startLat: visit.startLat,
              startLng: visit.startLng,
              startAddress: visit.startAddress,
              endTime: visit.endTime,
              endLat: visit.endLat,
              endLng: visit.endLng,
              endAddress: visit.endAddress,
              distanceKm: visit.distanceKm,
              durationMins: visit.durationMins,
              routePoints: visit.routePoints as any,
              status: visit.status,
              purpose: visit.purpose,
              notes: visit.notes,
              photos: {
                create: visit.photos.map((p: any) => ({
                  url: p.url,
                  takenAt: p.takenAt,
                  caption: p.caption,
                })),
              },
            },
          });
        }
      }

      // ── Discussions (threads, comments, attachments) — opt-in ───────────
      if (copy.discussions && source.discussions.length) {
        for (const discussion of source.discussions) {
          await tx.projectDiscussion.create({
            data: {
              title: discussion.title,
              content: discussion.content,
              projectId: project.id,
              authorId:
                discussion.authorId && activeIds.has(discussion.authorId)
                  ? discussion.authorId
                  : actorEmployeeId,
              comments: {
                create: discussion.comments.map((c: any) => ({
                  content: c.content,
                  authorId: activeIds.has(c.authorId) ? c.authorId : actorEmployeeId,
                })),
              },
              attachments: {
                create: discussion.attachments.map((a: any) => ({
                  fileName: a.fileName,
                  fileUrl: a.fileUrl,
                  fileSize: a.fileSize,
                  uploadedById: activeIds.has(a.uploadedById) ? a.uploadedById : actorEmployeeId,
                })),
              },
            },
          });
        }
      }

      // ── Project tickets — opt-in ────────────────────────────────────────
      // ticketNumber is unique per company, so every duplicated ticket needs a
      // fresh number, sequenced past everything already in the workspace.
      if (copy.tickets && source.projectTickets.length) {
        let tktSeq = await tx.projectTicket.count({ where: { companyId } });
        for (const ticket of source.projectTickets) {
          await tx.projectTicket.create({
            data: {
              ticketNumber: `TKT-${String(++tktSeq).padStart(4, '0')}`,
              title: ticket.title,
              description: ticket.description,
              projectId: project.id,
              companyId,
              raisedById: activeIds.has(ticket.raisedById) ? ticket.raisedById : actorEmployeeId,
              proposedAssigneeId:
                ticket.proposedAssigneeId && activeIds.has(ticket.proposedAssigneeId)
                  ? ticket.proposedAssigneeId
                  : null,
              priority: ticket.priority,
              startDate: applyDate(ticket.startDate),
              dueDate: applyDate(ticket.dueDate),
              estimatedHours: ticket.estimatedHours,
              status: ticket.status,
              reviewedById:
                ticket.reviewedById && activeIds.has(ticket.reviewedById) ? ticket.reviewedById : null,
              reviewedAt: ticket.reviewedAt,
              rejectionReason: ticket.rejectionReason,
              convertedIssueId:
                ticket.convertedIssueId != null ? (issueMap.get(ticket.convertedIssueId) ?? null) : null,
              convertedAt: ticket.convertedAt,
            },
          });
        }
      }

      // ── Budget requests — opt-in ────────────────────────────────────────
      if (copy.budgetRequests && source.budgetRequests.length) {
        for (const request of source.budgetRequests) {
          await tx.projectBudgetRequest.create({
            data: {
              projectId: project.id,
              companyId,
              requestedById:
                request.requestedById && activeIds.has(request.requestedById)
                  ? request.requestedById
                  : actorEmployeeId,
              additionalHours: request.additionalHours,
              hoursBefore: request.hoursBefore,
              hoursAfter: request.hoursAfter,
              budgetBefore: request.budgetBefore,
              budgetAfter: request.budgetAfter,
              additionalBudget: request.additionalBudget,
              reason: request.reason,
              attachmentUrl: request.attachmentUrl,
              attachmentName: request.attachmentName,
              status: request.status,
              reviewedById:
                request.reviewedById && activeIds.has(request.reviewedById) ? request.reviewedById : null,
              reviewedAt: request.reviewedAt,
              rejectionReason: request.rejectionReason,
            },
          });
        }
      }

      // issueSeq must know how many keys were consumed, or the first task
      // raised by hand would collide on @@unique([key, companyId]).
      await tx.project.update({ where: { id: project.id }, data: { issueSeq: seq } });

      return project;
    });

    return duplicated;
  }

  async createAiProject(companyId: number, leadId: number, data: any) {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const baseKey = `CES/${mm}${yy}/`;

    const existingProjects = await this.prisma.project.findMany({
      where: {
        companyId,
        key: { startsWith: baseKey }
      },
      select: { key: true }
    });

    let maxSeq = 0;
    for (const proj of existingProjects) {
      const parts = proj.key.split('/');
      if (parts.length === 3) {
        const seqNum = parseInt(parts[2], 10);
        if (!isNaN(seqNum) && seqNum > maxSeq) {
          maxSeq = seqNum;
        }
      }
    }

    const nextSeq = String(maxSeq + 1).padStart(2, '0');
    const finalKey = `${baseKey}${nextSeq}`;

    try {
      // Create a client automatically using the project name
      const autoClient = await this.prisma.client.create({
        data: {
          name: data.name,
          companyId
        }
      });

      const newProject = await this.prisma.project.create({
        data: {
          name: data.name,
          key: finalKey,
          description: data.description,
          summary: data.summary ?? null,
          address: data.address ?? null,
          onsiteRepresentation: data.onsiteRepresentation?.trim() || null,
          companyId,
          leadId,
          status: 'DRAFT',
          onboardingStatus: 'DRAFT',
          budgetAmount: data.budgetAmount ? parseFloat(data.budgetAmount) : null,
          startDate: data.startDate ? new Date(data.startDate) : null,
          endDate: data.endDate ? new Date(data.endDate) : null,
          clientId: autoClient.id,

          members: {
            create: buildInitialMembers(
              leadId, data.pmIds, (data as any).memberIds, (data as any).architectIds,
            ),
          },
          boards: {
            create: {
              name: 'Main Board',
              columns: {
                create: [
                  { name: 'To Do', color: '#6b7280', position: 0, isSystem: true, type: 'TODO' },
                  { name: 'In Progress', color: '#3b82f6', position: 1, isSystem: true, type: 'IN_PROGRESS' },
                  { name: 'In Review', color: '#8b5cf6', position: 2, isSystem: true, type: 'REVIEW' },
                  { name: 'Completed', color: '#22c55e', position: 3, isSystem: true, type: 'DONE' },
                  { name: 'Cancelled', color: '#ef4444', position: 4, isSystem: true, type: 'CANCELLED' }
                ]
              }
            }
          }
        }
      });

      return newProject;
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Could not create AI project draft');
    }
  }

  async getProjectAnalysis(companyId: number, projectId: number) {
    const run = await this.prisma.projectAnalysisRun.findFirst({
      where: { projectId, project: { companyId } },
      orderBy: { version: 'desc' },
      include: {
        summary: true,
        scope: true,
        requirements: true,
        wbsTasks: true,
        resourcePlans: true,
        costEstimate: true,
        roadmap: true,
        milestones: true,
        risks: true,
        dependencies: true,
        assumptions: true,
        stakeholders: true,
        raci: true,
        openQuestions: true,
        missingInfo: true,
        recommendations: true,
        aiConfidence: true,
        health: true,
        kickoffReadiness: true,
      }
    });

    if (!run) {
      throw new NotFoundException('No analysis run found for this project');
    }
    return run;
  }

  async kickoffProject(companyId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      include: { boards: { include: { columns: true } } }
    });
    if (!project) throw new NotFoundException('Project not found');

    const analysis = await this.getProjectAnalysis(companyId, projectId);
    if (!analysis || !analysis.wbsTasks) throw new BadRequestException('No WBS tasks to kickoff');

    const mainBoard = project.boards[0];
    if (!mainBoard) throw new BadRequestException('Project has no board setup');

    const todoColumn = mainBoard.columns.find(c => c.name.toLowerCase() === 'to do' || c.position === 0);
    if (!todoColumn) throw new BadRequestException('Board has no To Do column');

    // Make sure we don't duplicate if already kicked off
    if (project.onboardingStatus === 'COMPLETED') {
      return project;
    }

    // Number the WBS tasks from what the project already holds, not from one,
    // so the analysis cannot reuse a number an earlier task already carries.
    // A fresh AI draft has none, so this ordinarily starts at one -- but it is
    // the same rule the other key writers follow, and it costs nothing here.
    const [existing, seqRow] = await Promise.all([
      this.prisma.issue.count({ where: { projectId, companyId } }),
      this.prisma.project.findUnique({ where: { id: projectId }, select: { issueSeq: true } }),
    ]);
    const base = Math.max(existing, seqRow?.issueSeq ?? 0);

    let position = 0;
    const issues = analysis.wbsTasks.map((task, idx) => {
      return {
        title: task.task,
        description: task.description || '',
        projectId: project.id,
        columnId: todoColumn.id,
        type: 'TASK',
        status: 'TODO',
        key: `${project.key}-${base + idx + 1}`,
        position: position++,
        startDate: task.startDate ? new Date(task.startDate) : null,
        dueDate: task.endDate ? new Date(task.endDate) : null,
        estimatedHours: task.estimatedEffort || null,
        companyId
      };
    });

    if (issues.length > 0) {
      await this.prisma.issue.createMany({
        data: issues
      });

      // Advance the counter here, not only in the seed that follows. The seed
      // is deliberately non-fatal, and a project whose seed failed must not
      // hand the next manual task a number one of these already holds.
      await this.prisma.project.update({
        where: { id: projectId },
        data: { issueSeq: base + issues.length },
      });
    }

    // §1: the six management tasks, now that this is a real project.
    //
    // Not at createAiProject: that writes a DRAFT placeholder named "Project
    // Setup <timestamp>" before anybody has confirmed the project exists.
    // Kickoff is the moment it becomes real, and is already guarded against
    // running twice by the COMPLETED check above.
    const pmMembers = await this.prisma.projectMember.findMany({
      where: { projectId, role: 'PROJECT_MANAGER' },
      select: { employeeId: true },
    });
    await this.seedDefaultProjectTasks(
      companyId,
      { id: projectId, key: project.key },
      project.leadId ?? 0,
      { pmIds: pmMembers.map((m) => m.employeeId) },
    );

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        onboardingStatus: 'COMPLETED',
        status: 'ACTIVE'
      }
    });
  }

  /**
   * Project-level documents (§6): the scope, the proposal, the agreement.
   *
   * Distinct from task attachments, which the Attachments tab was showing on
   * its own — those belong to a work item, these belong to the project.
   */
  async listProjectDocuments(companyId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found');

    return this.prisma.projectDocument.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, url: true, type: true, status: true,
        createdAt: true, updatedAt: true,
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });
  }

  /**
   * Rename a document, keeping whatever extension it was uploaded with.
   *
   * The bytes are not re-uploaded, so the extension must not move: it is what
   * decides whether a browser previews or downloads the file, and which parser
   * reads it. See document-naming.ts.
   */
  async renameProjectDocument(companyId: number, projectId: number, documentId: number, requestedName: string) {
    const doc = await this.prisma.projectDocument.findFirst({
      where: { id: documentId, projectId, project: { companyId } },
      select: { id: true, name: true },
    });
    if (!doc) throw new NotFoundException('Document not found');

    let name: string;
    try {
      name = renameKeepingExtension(doc.name, requestedName);
    } catch (e) {
      if (e instanceof InvalidDocumentName) throw new BadRequestException(e.message);
      throw e;
    }

    return this.prisma.projectDocument.update({
      where: { id: documentId },
      data: { name },
      select: { id: true, name: true, url: true, type: true, updatedAt: true },
    });
  }

  async deleteProjectDocument(companyId: number, projectId: number, documentId: number) {
    const doc = await this.prisma.projectDocument.findFirst({
      where: { id: documentId, projectId, project: { companyId } },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('Document not found');

    await this.prisma.projectDocument.delete({ where: { id: documentId } });
    return { success: true };
  }

  /**
   * @param requestedName optional name to store the file under. Run through
   *   the same extension-preserving rule as a later rename, so there is one
   *   authority for what a document may be called rather than a second copy
   *   of the rule living in the browser.
   */
  async uploadProjectDocument(
    companyId: number,
    projectId: number,
    uploadedBy: number,
    file: Express.Multer.File,
    requestedName?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');

    let documentName = file.originalname;
    if (requestedName?.trim()) {
      try {
        documentName = renameKeepingExtension(file.originalname, requestedName);
      } catch (e) {
        if (e instanceof InvalidDocumentName) throw new BadRequestException(e.message);
        throw e;
      }
    }

    // Verify project access
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId }
    });
    if (!project) throw new NotFoundException('Project not found');

    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) throw new HttpException('ImageKit not configured', HttpStatus.INTERNAL_SERVER_ERROR);

    try {
      // 1. Upload to ImageKit
      const ext = path.extname(file.originalname);
      const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
      
      const form = new FormData();
      form.append('file', file.buffer.toString('base64'));
      form.append('fileName', filename);
      form.append('folder', '/project_documents');

      const authHeader = 'Basic ' + Buffer.from(privateKey + ':').toString('base64');
      const response = await axios.post('https://upload.imagekit.io/api/v1/files/upload', form, {
        headers: { ...form.getHeaders(), Authorization: authHeader }
      });

      const url = response.data.url;
      const fileId = response.data.fileId;

      // 2. Extract Text (if PDF, DOCX, or XLSX)
      let rawText: string | null = null;
      let status = 'PENDING';
      const fileExt = ext.toLowerCase();

      try {
        if (fileExt === '.pdf') {
          if (typeof pdfParse === 'function') {
            const data = await pdfParse(file.buffer);
            rawText = data.text;
          } else if (pdfParse && pdfParse.PDFParse) {
            const parser = new pdfParse.PDFParse({ data: file.buffer });
            const res = await parser.getText();
            rawText = res.text;
            if (typeof parser.destroy === 'function') await parser.destroy();
          } else if ((pdfParse as any).default && typeof (pdfParse as any).default === 'function') {
            const data = await (pdfParse as any).default(file.buffer);
            rawText = data.text;
          }
          status = 'EXTRACTED';
        } else if (fileExt === '.docx') {
          const result = await mammoth.extractRawText({ buffer: file.buffer });
          rawText = result.value;
          status = 'EXTRACTED';
        } else if (fileExt === '.xlsx' || fileExt === '.xls') {
          const workbook = xlsx.read(file.buffer, { type: 'buffer' });
          const sheetsText = workbook.SheetNames.map(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            return `--- Sheet: ${sheetName} ---\n` + xlsx.utils.sheet_to_csv(worksheet);
          }).join('\n\n');
          rawText = sheetsText;
          status = 'EXTRACTED';
        } else if (['.txt', '.csv', '.md', '.json', '.log'].includes(fileExt)) {
          rawText = file.buffer.toString('utf-8');
          status = 'EXTRACTED';
        } else {
          // Fallback plain text read
          rawText = file.buffer.toString('utf-8');
          status = 'EXTRACTED';
        }
      } catch (e) {
        console.error(`Parse error for ${fileExt}:`, e);
        status = 'ERROR';
      }

      // 3. Save or Update in database (Handle re-upload of same file name)
      const existingDoc = await this.prisma.projectDocument.findFirst({
        where: { projectId, name: documentName }
      });

      let doc;
      if (existingDoc) {
        doc = await this.prisma.projectDocument.update({
          where: { id: existingDoc.id },
          data: {
            url,
            fileId,
            type: ext.toLowerCase().replace('.', ''),
            rawText,
            status,
            uploadedBy,
            updatedAt: new Date()
          }
        });
      } else {
        doc = await this.prisma.projectDocument.create({
          data: {
            projectId,
            name: documentName,
            url,
            fileId,
            type: ext.toLowerCase().replace('.', ''),
            rawText,
            status,
            uploadedBy
          }
        });
      }

      return doc;
    } catch (error) {
      console.error(error);
      throw new HttpException('Failed to process project document', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async analyzeProjectDocuments(companyId: number, projectId: number) {
    // Phase 2: AI Orchestration goes here
    // For now, return a success indicator
    return { status: 'ANALYZING', message: 'Analysis started in background' };
  }

  async getProjects(companyId: number, userId: number, role: string) {
    const emp = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true, department: { select: { defaultRole: true } } },
    });
    const isAdmin = await hasCompanyWideProjectAccess(
      this.prisma, companyId, role, emp?.department?.defaultRole,
    );
    // isSystem excludes the hidden "General" project, which exists only to give
    // projectless tasks a key, a board column and a detail screen. It is not a
    // project anybody works on and must never appear in a board list.
    const whereClause: any = { companyId, status: 'ACTIVE', isSystem: false };
    
    const empId = emp ? emp.id : userId;

    if (!isAdmin) {
      whereClause.members = {
        some: { employeeId: empId }
      };
    }

    const projects = await this.prisma.project.findMany({
      where: whereClause,
      include: {
        _count: {
          // Archived tasks are off the board, so they are not in the count either.
          select: { members: true, issues: { where: { isArchived: false } }, milestones: true }
        },
        lead: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        },
        // Client and department are columns and filters on the list, so they
        // come down with it rather than costing a lookup per row.
        client: {
          select: { id: true, name: true }
        },
        leadContact: {
          select: { id: true, name: true, companyName: true }
        },
        department: {
          select: { id: true, name: true }
        },
        members: {
          orderBy: { joinedAt: 'asc' },
          select: {
            employeeId: true,
            role: true,
            isStarred: true,
            employee: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true }
            }
          }
        },
        // Active tasks only, matching the board and the card count.
        issues: {
          where: { isArchived: false },
          select: { status: true }
        },
        expenseClaims: {
          where: { status: { in: ['APPROVED', 'PAID'] } },
          select: { amount: true, status: true }
        }
      },
      // Newest first. Without an order Prisma returns whatever the database
      // hands back, which put a project somebody had just created at the
      // bottom of the list they were looking at.
      orderBy: { createdAt: 'desc' },
    });

    const costByProject = await this.getCostRollupByProject(projects.map((p) => p.id), companyId);

    const rows = projects.map(({ issues, expenseClaims, ...p }) => {
      const totalIssues = issues.length;
      const doneIssues = issues.filter((i) => i.status === 'DONE').length;
      const cost = costByProject.get(p.id) ?? { loggedHours: 0, employeeCost: 0, unratedHours: 0 };
      const expenseTotal = expenseClaims.reduce((sum, c) => sum + c.amount, 0);
      // §23: what the project has actually consumed — the people on it plus
      // the expenses approved against it. Approved, not merely claimed: an
      // unreviewed claim is not yet a cost.
      const actualCost = Math.round((cost.employeeCost + expenseTotal) * 100) / 100;

      return {
        ...p,
        remainingIssues: issues.filter((i) => i.status !== 'DONE' && i.status !== 'CANCELLED').length,
        totalIssues,
        doneIssues,
        // §11: progress from task completion, unless a PM has set it by hand.
        progress: p.progress ?? (totalIssues ? Math.round((doneIssues / totalIssues) * 100) : 0),
        loggedHours: cost.loggedHours,
        remainingHours: p.estimatedHours == null ? null : p.estimatedHours - cost.loggedHours,
        expenseTotal,
        paidExpenseTotal: expenseClaims
          .filter((c) => c.status === 'PAID')
          .reduce((sum, c) => sum + c.amount, 0),
        employeeCost: cost.employeeCost,
        /// Hours the cost figure could not price, because the person who
        /// logged them has no rate. Non-zero means employeeCost is an
        /// understatement, and the UI says so rather than letting the number
        /// pass as complete.
        unratedHours: cost.unratedHours,
        actualCost,
        budgetUsed: actualCost,
        budgetRemaining: p.budgetAmount == null ? null : Math.round((p.budgetAmount - actualCost) * 100) / 100,
        budgetUtilization:
          p.budgetAmount ? Math.round((actualCost / p.budgetAmount) * 100) : null,
        milestoneTotal: p._count?.milestones ?? 0,
      };
    });

    return applyFinancialVisibilityAll(rows, { role, employeeId: emp ? emp.id : null });
  }

  /**
   * Logged hours and employee cost per project (§8, §22, §23).
   *
   * One grouped query rather than including `timeLogs` on every issue: a
   * project with a thousand tasks and years of timer sessions would otherwise
   * pull every row across the wire to add them up.
   *
   * `unratedHours` is the part of the total logged by people with no
   * hourlyCostRate. It is carried alongside the cost rather than folded into
   * it, because those hours are real work that cost is silently missing — a
   * project reporting itself cheaper than it is would be worse than one
   * saying which hours it could not price.
   *
   * ── Which hours count (§22) ────────────────────────────────────────────
   * A day is joined to its TimesheetDay, and the company setting decides how
   * strictly that judgement is applied:
   *
   *   OFF (default) — everything counts EXCEPT days somebody rejected.
   *     Absence of a row means "not submitted", never "rejected": every hour
   *     logged before approvals existed has no row, and treating those as
   *     refused would drop project cost to zero across the whole history the
   *     moment this shipped. Rejection is the one thing that excludes.
   *
   *   ON — only APPROVED days count. The stricter reading, for a company that
   *     wants cost measured from reviewed time and nothing else.
   *
   * Until now neither applied: rejected hours were costed exactly like
   * approved ones, so rejecting a day changed a status and nothing else.
   */
  /**
   * Hours logged on a project, per person and per day (§PB3).
   *
   * Shares getCostRollupByProject's rule about which logged hours count: when
   * timesheet approval is on, only approved days; otherwise everything except
   * rejected. A graph that counted hours the cost figure refuses would put two
   * numbers on one screen that cannot both be right.
   *
   * `days` bounds the window. Unbounded would mean a two-year project renders
   * seven hundred bars, and nobody reads a timesheet graph to find out about
   * last March.
   */
  async getProjectTimesheetGraph(
    companyId: number,
    projectId: number,
    days = 30,
  ) {
    const window = Math.min(Math.max(Math.round(days) || 30, 1), 180);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (window - 1));

    const settings = await this.prisma.systemSetting.findUnique({
      where: { companyId },
      select: { timesheetApprovalRequired: true },
    });
    const approvalRequired = settings?.timesheetApprovalRequired ?? false;
    const countable = approvalRequired
      ? Prisma.sql`d."status" = 'APPROVED'`
      : Prisma.sql`(d."status" IS NULL OR d."status" <> 'REJECTED')`;

    const rows = await this.prisma.$queryRaw<
      {
        employeeId: number; firstName: string | null; lastName: string | null;
        avatarUrl: string | null; day: Date; minutes: bigint | null;
      }[]
    >`
      SELECT t."employeeId"                     AS "employeeId",
             e."firstName"                      AS "firstName",
             e."lastName"                       AS "lastName",
             e."avatarUrl"                      AS "avatarUrl",
             (t."startedAt")::date              AS day,
             SUM(COALESCE(t."durationMin", 0))  AS minutes
        FROM "IssueTimeLog" t
        JOIN "Issue" i    ON i.id = t."issueId"
        JOIN "Employee" e ON e.id = t."employeeId"
        LEFT JOIN "TimesheetDay" d
               ON d."employeeId" = t."employeeId"
              AND d."date" = (t."startedAt")::date
       WHERE i."projectId" = ${projectId}
         AND i."companyId" = ${companyId}
         AND t."startedAt" >= ${since}
         AND ${countable}
       GROUP BY t."employeeId", e."firstName", e."lastName", e."avatarUrl", (t."startedAt")::date
    `;

    const hours = (min: bigint | null) => Math.round((Number(min ?? 0) / 60) * 100) / 100;

    const byMember = new Map<number, { employeeId: number; name: string; avatarUrl: string | null; hours: number }>();
    const byDay = new Map<string, number>();

    for (const r of rows) {
      const h = hours(r.minutes);

      const member = byMember.get(r.employeeId) ?? {
        employeeId: r.employeeId,
        name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || `Employee ${r.employeeId}`,
        avatarUrl: r.avatarUrl,
        hours: 0,
      };
      member.hours = Math.round((member.hours + h) * 100) / 100;
      byMember.set(r.employeeId, member);

      const key = new Date(r.day).toISOString().slice(0, 10);
      byDay.set(key, Math.round(((byDay.get(key) ?? 0) + h) * 100) / 100);
    }

    const members = [...byMember.values()].sort((a, b) => b.hours - a.hours);
    const totalHours = Math.round(members.reduce((sum, m) => sum + m.hours, 0) * 100) / 100;

    return {
      windowDays: window,
      since: since.toISOString().slice(0, 10),
      /** Whether these hours are the approved ones, so the UI can say which. */
      approvedOnly: approvalRequired,
      totalHours,
      /** Sorted by hours: the graph reads as a ranking, biggest bar first. */
      byMember: members,
      /**
       * Every day in the window, including the ones nobody logged against.
       * Omitting them would draw a continuous line over weekends and holidays
       * and make an idle fortnight look like steady work.
       */
      byDay: Array.from({ length: window }, (_, i) => {
        const d = new Date(since);
        d.setDate(d.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        return { date: key, hours: byDay.get(key) ?? 0 };
      }),
    };
  }

  private async getCostRollupByProject(
    projectIds: number[],
    companyId: number,
  ): Promise<
    Map<number, { loggedHours: number; employeeCost: number; unratedHours: number }>
  > {
    if (!projectIds.length) return new Map();

    const settings = await this.prisma.systemSetting.findUnique({
      where: { companyId },
      select: { timesheetApprovalRequired: true },
    });
    const approvalRequired = settings?.timesheetApprovalRequired ?? false;

    // The rate per hour (19 Oct 2026): the employee's own hourlyCostRate when
    // set; otherwise their monthly salary (the earnings in their salary
    // structure) over STANDARD_MONTH_HOURS. Only hours with neither are
    // "unrated" and priced at 0.
    const rows = await this.prisma.$queryRaw<
      { projectId: number; minutes: bigint | null; cost: number | null; unratedMinutes: bigint | null }[]
    >`
      WITH salary AS (
        SELECT ss."employeeId", SUM(ss.amount) AS monthly
          FROM "SalaryStructure" ss
          JOIN "SalaryComponent" sc ON sc.id = ss."componentId"
         WHERE sc.type = 'EARNING'
         GROUP BY ss."employeeId"
      ), rate AS (
        SELECT e.id,
               COALESCE(e."hourlyCostRate",
                        CASE WHEN s.monthly > 0 THEN s.monthly / ${Prisma.raw(String(STANDARD_MONTH_HOURS) + '.0')} END) AS r
          FROM "Employee" e
          LEFT JOIN salary s ON s."employeeId" = e.id
      )
      SELECT i."projectId"                        AS "projectId",
             SUM(COALESCE(t."durationMin", 0))    AS minutes,
             SUM(COALESCE(t."durationMin", 0) / 60.0
                 * COALESCE(rt.r, 0))             AS cost,
             SUM(CASE WHEN rt.r IS NULL
                      THEN COALESCE(t."durationMin", 0) ELSE 0 END) AS "unratedMinutes"
        FROM "IssueTimeLog" t
        JOIN "Issue" i    ON i.id = t."issueId"
        JOIN rate rt      ON rt.id = t."employeeId"
        -- The day this log belongs to, if anybody has judged it. LEFT, because
        -- most days have no row at all and those hours still count.
        LEFT JOIN "TimesheetDay" d
               ON d."employeeId" = t."employeeId"
              AND d."date" = (t."startedAt")::date
       WHERE i."projectId" IN (${Prisma.join(projectIds)})
         AND ${
           approvalRequired
             ? Prisma.sql`d."status" = 'APPROVED'`
             : Prisma.sql`(d."status" IS NULL OR d."status" <> 'REJECTED')`
         }
       GROUP BY i."projectId"
    `;

    const toHours = (min: bigint | null) => Math.round((Number(min ?? 0) / 60) * 100) / 100;

    return new Map(
      rows.map((r) => [
        r.projectId,
        {
          loggedHours: toHours(r.minutes),
          employeeCost: Math.round(Number(r.cost ?? 0) * 100) / 100,
          unratedHours: toHours(r.unratedMinutes),
        },
      ]),
    );
  }

  async getArchivedProjects(companyId: number, userId: number, role: string) {
    const emp = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true, department: { select: { defaultRole: true } } },
    });
    const isAdmin = await hasCompanyWideProjectAccess(
      this.prisma, companyId, role, emp?.department?.defaultRole,
    );
    const whereClause: any = { companyId, status: 'ARCHIVED', isSystem: false };
    
    const empId = emp ? emp.id : userId;

    if (!isAdmin) {
      whereClause.members = {
        some: { employeeId: empId }
      };
    }

    return this.prisma.project.findMany({
      where: whereClause,
      include: {
        _count: {
          select: { members: true, issues: { where: { isArchived: false } } }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });
  }

  async getProjectDetails(companyId: number, projectId: number, userId: number, role: string) {
    const emp = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true, department: { select: { defaultRole: true } } },
    });
    const isAdmin = await hasCompanyWideProjectAccess(
      this.prisma, companyId, role, emp?.department?.defaultRole,
    );

    if (!isAdmin) {
      const empId = emp ? emp.id : userId;
      const isMember = await this.prisma.projectMember.findFirst({
        where: { projectId, employeeId: empId }
      });
      if (!isMember) {
        throw new ForbiddenException('You do not have access to this project');
      }
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId, companyId },
      include: {
        lead: {
          select: { id: true, userId: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } } }
        },
        members: {
          include: {
            employee: {
              // userId, because an @mention has to name a USER: notifications
              // hang off User, not Employee. Without it the discussion
              // mention list filtered every member out and the @ menu came up
              // empty — the feature looked broken while the bug was a missing
              // field in this select.
              select: {
                id: true, userId: true, firstName: true, lastName: true, avatarUrl: true,
                user: { select: { email: true } }
              }
            }
          }
        },
        boards: {
          include: {
            columns: {
              orderBy: { position: 'asc' }
            }
          }
        },
        documents: {
          include: {
            employee: { select: { firstName: true, lastName: true, avatarUrl: true } }
          }
        },
        client: {
          select: { id: true, name: true }
        },
        parent: { select: { id: true, key: true, name: true, budgetMode: true } },
        subprojects: {
          where: { status: 'ACTIVE' },
          orderBy: { subCode: 'asc' },
          select: {
            id: true, key: true, name: true, subCode: true, workStatus: true, progress: true,
            lead: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
            members: { where: { role: 'PROJECT_MANAGER' }, select: { employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } } },
            _count: { select: { issues: { where: { isArchived: false } } } },
          },
        },
      }
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  /**
   * The numbers on the Summary and Reports tabs.
   *
   * Scoped the same way the board is. A member who sees six of a project's
   * forty tasks must not read "40 tasks, 12 done" here — the count would hand
   * back exactly what the board withholds.
   */
  async getProjectSummary(
    companyId: number, projectId: number,
    employeeId: number | null = null, companyRole?: string,
  ) {
    const viewer = await resolveProjectViewer(
      this.prisma as any, companyId, projectId, employeeId, companyRole,
    );

    // §PB5: the summary is a money document — it reports spend, remaining
    // budget and what each member's logged hours cost. The client hides the
    // tab from everyone else, but a hidden tab is not a permission: without
    // this the figures were a plain GET away for any member of the project.
    if (!seesProjectFinancials(viewer)) {
      throw new ForbiddenException(
        'Only the project manager, the project owner, finance or a super administrator can view the project summary.',
      );
    }

    const visible = taskVisibilityFilter(viewer);
    /** Folded into every task query below; empty when they see everything. */
    const scope = visible ? { AND: [visible] } : {};
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const [
      completedLast7Days,
      updatedLast7Days,
      createdLast7Days,
      dueSoonNext7Days,
      statusGroups,
      issueMembersGroups,
      unassignedCount,
      priorityGroups,
      recentActivity,
      typeGroups,
      estimatedHoursSum,
      loggedMinutesSum,
      fourteenDaysIssues
    ] = await Promise.all([
      this.prisma.issue.count({
        where: { projectId, companyId, ...scope, isArchived: false, status: 'DONE', updatedAt: { gte: sevenDaysAgo } }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, ...scope, isArchived: false, updatedAt: { gte: sevenDaysAgo } }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, ...scope, isArchived: false, createdAt: { gte: sevenDaysAgo } }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, ...scope, isArchived: false, dueDate: { gte: new Date(), lte: sevenDaysFromNow }, status: { not: 'DONE' } }
      }),
      this.prisma.issue.groupBy({
        by: ['status'],
        where: { projectId, companyId, ...scope, isArchived: false },
        _count: { _all: true }
      }),
      this.prisma.issueMember.groupBy({
        by: ['employeeId'],
        // Who is on the work — read through the issue, so it is the same slice
        // of tasks as everything else here.
        where: { issue: { projectId, companyId, ...scope, isArchived: false } },
        _count: { _all: true }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, ...scope, isArchived: false, members: { none: {} } }
      }),
      this.prisma.issue.groupBy({
        by: ['priority'],
        where: { projectId, companyId, ...scope, isArchived: false },
        _count: { _all: true }
      }),
      this.prisma.issueActivity.findMany({
        where: { issue: { projectId, companyId, ...scope } },
        include: {
          actor: { select: { firstName: true, lastName: true, avatarUrl: true } },
          issue: { select: { id: true, key: true, title: true, status: true, type: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      }),
      this.prisma.issue.groupBy({
        by: ['type'],
        where: { projectId, companyId, ...scope, isArchived: false },
        _count: { _all: true }
      }),
      this.prisma.issue.aggregate({
        _sum: { estimatedHours: true },
        where: { projectId, companyId, ...scope, isArchived: false }
      }),
      this.prisma.issueTimeLog.aggregate({
        _sum: { durationMin: true },
        where: { issue: { projectId, companyId, ...scope } }
      }),
      this.prisma.issue.findMany({
        where: { 
          projectId, companyId, ...scope, isArchived: false,
          OR: [
            { createdAt: { gte: new Date(new Date().setDate(new Date().getDate() - 14)) } },
            { status: 'DONE', updatedAt: { gte: new Date(new Date().setDate(new Date().getDate() - 14)) } }
          ]
        },
        select: { createdAt: true, status: true, updatedAt: true }
      })
    ]);

    // Format assignee groups with names
    const assigneeIds = issueMembersGroups.map(a => a.employeeId);
    let assignees: any[] = [];
    if (assigneeIds.length > 0) {
      assignees = await this.prisma.employee.findMany({
        where: { id: { in: assigneeIds as number[] } },
        select: { id: true, firstName: true, lastName: true, avatarUrl: true }
      });
    }

    const teamWorkload: any[] = issueMembersGroups.map(g => {
      const emp = assignees.find(a => a.id === g.employeeId);
      return {
        assigneeId: g.employeeId,
        name: emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown',
        avatarUrl: emp?.avatarUrl || null,
        count: g._count._all
      };
    });

    if (unassignedCount > 0) {
      teamWorkload.push({
        assigneeId: null,
        name: 'Unassigned',
        avatarUrl: null,
        count: unassignedCount
      });
    }

    const completionTrends: { date: string; created: number; completed: number }[] = [];
    const fourteenDaysAgoDate = new Date();
    fourteenDaysAgoDate.setDate(fourteenDaysAgoDate.getDate() - 13);
    for (let i = 0; i < 14; i++) {
      const d = new Date(fourteenDaysAgoDate);
      d.setDate(d.getDate() + i);
      completionTrends.push({ date: d.toISOString().split('T')[0], created: 0, completed: 0 });
    }

    fourteenDaysIssues.forEach(issue => {
      const createdStr = issue.createdAt.toISOString().split('T')[0];
      const createdBin = completionTrends.find(t => t.date === createdStr);
      if (createdBin) createdBin.created++;

      if (issue.status === 'DONE' && issue.updatedAt) {
        const completedStr = issue.updatedAt.toISOString().split('T')[0];
        const completedBin = completionTrends.find(t => t.date === completedStr);
        if (completedBin) completedBin.completed++;
      }
    });

    // §PB6: the commercial read of the project.
    //
    // Cost comes from getCostRollupByProject rather than a sum computed here,
    // so the summary cannot disagree with the project list about what a project
    // has cost — and so it inherits the timesheetApprovalRequired rule about
    // which logged hours are allowed to count.
    const [project, approvedExtras, costRollup] = await Promise.all([
      this.prisma.project.findFirst({
        where: { id: projectId, companyId },
        select: {
          budgetAmount: true, estimatedHours: true, hourlyRate: true, currency: true,
        },
      }),
      this.prisma.projectBudgetRequest.aggregate({
        where: { projectId, companyId, status: 'APPROVED' },
        _sum: { additionalBudget: true, additionalHours: true },
      }),
      this.getCostRollupByProject([projectId], companyId),
    ]);

    const rollup = costRollup.get(projectId)
      ?? { loggedHours: 0, employeeCost: 0, unratedHours: 0 };

    // Approved increases are part of the budget. A project running to an
    // agreed overspend is on budget; showing it against the original figure
    // would report every approved request as a failure.
    const budget = (project?.budgetAmount ?? 0) + (approvedExtras._sum.additionalBudget ?? 0);
    const hoursBudget = (project?.estimatedHours ?? 0) + (approvedExtras._sum.additionalHours ?? 0);

    const round = (n: number) => Math.round(n * 100) / 100;
    const pct = (used: number, total: number) =>
      total > 0 ? Math.round((used / total) * 100) : null;

    // A parent sees its subprojects counted in; a subproject sees which
    // parent it belongs to and whether it spends from that parent's budget.
    const hierarchy = seesProjectFinancials(viewer)
      ? await this.subprojectBudgetRollup(companyId, projectId, {
          total: budget, spent: rollup.employeeCost, loggedHours: rollup.loggedHours,
        })
      : null;

    return {
      hierarchy,
      budget: {
        currency: project?.currency ?? 'INR',
        /** What was agreed originally, before any approved increase. */
        original: round(project?.budgetAmount ?? 0),
        approvedExtra: round(approvedExtras._sum.additionalBudget ?? 0),
        total: round(budget),
        spent: round(rollup.employeeCost),
        remaining: round(budget - rollup.employeeCost),
        /** Null rather than 0 when there is no budget: "no budget set" and
         *  "nothing spent" are different facts and must not render alike. */
        percentUsed: pct(rollup.employeeCost, budget),
        hours: {
          original: round(project?.estimatedHours ?? 0),
          approvedExtra: round(approvedExtras._sum.additionalHours ?? 0),
          total: round(hoursBudget),
          logged: round(rollup.loggedHours),
          remaining: round(hoursBudget - rollup.loggedHours),
          percentUsed: pct(rollup.loggedHours, hoursBudget),
        },
        /**
         * Hours logged by people with no cost rate on file. They are in the
         * hours but contribute nothing to spend, so the figure is understated
         * by however much they are worth. Reported rather than hidden: a
         * budget number quietly missing a chunk of its cost is worse than one
         * that admits it.
         */
        unratedHours: round(rollup.unratedHours),
      },
      metrics: {
        completedLast7Days,
        updatedLast7Days,
        createdLast7Days,
        dueSoonNext7Days
      },
      statusOverview: statusGroups.map(g => ({ status: g.status, count: g._count._all })),
      teamWorkload,
      priorityBreakdown: priorityGroups.map(g => ({ priority: g.priority, count: g._count._all })),
      recentActivity,
      typeDistribution: typeGroups.map(g => ({ type: g.type, count: g._count._all })),
      timeTracking: {
        estimatedHours: estimatedHoursSum._sum.estimatedHours || 0,
        loggedHours: (loggedMinutesSum._sum.durationMin || 0) / 60
      },
      completionTrends
    };
  }

  async getProjectMembers(companyId: number, projectId: number) {
    return this.prisma.projectMember.findMany({
      where: { projectId, project: { companyId } },
      include: {
        employee: { select: { id: true, userId: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } } } }
      }
    });
  }

  async toggleProjectStar(companyId: number, projectId: number, userId: number) {
    const emp = await this.prisma.employee.findUnique({
      where: { userId }
    });

    const targetEmployeeId = emp ? emp.id : userId;

    let member = await this.prisma.projectMember.findFirst({
      where: { projectId, employeeId: targetEmployeeId }
    });

    if (!member) {
      member = await this.prisma.projectMember.create({
        data: { projectId, employeeId: targetEmployeeId, role: 'MEMBER', isStarred: true }
      });
      return { isStarred: true };
    }

    const updated = await this.prisma.projectMember.update({
      where: { id: member.id },
      data: { isStarred: !member.isStarred }
    });

    return { isStarred: updated.isStarred };
  }

  async addProjectMember(companyId: number, projectId: number, employeeId: number, role: string, actorEmployeeId?: number, actorRole?: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, companyId }
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (actorEmployeeId !== undefined && !(actorRole === 'SUPERADMIN' || actorRole === 'ADMIN') && project.leadId !== actorEmployeeId) {
      throw new ForbiddenException('Only the project owner can add members');
    }

    // The role decides what they see, so an unrecognised one would create a
    // member who matches no rule — visible to nobody's reckoning and holding
    // no rights. Anything unknown is a plain member.
    const known: string[] = Object.values(PROJECT_ROLE);
    const safeRole = known.includes(role) ? role : PROJECT_ROLE.MEMBER;

    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_employeeId: { projectId, employeeId } }
    });

    if (existing) {
      // Already on the board. Adding them again with a different role is how
      // the share panel promotes somebody, so honour it rather than ignoring
      // the click.
      if (existing.role !== safeRole) {
        return this.prisma.projectMember.update({
          where: { id: existing.id },
          data: { role: safeRole },
        });
      }
      return existing;
    }

    return this.prisma.projectMember.create({
      data: {
        projectId,
        employeeId,
        role: safeRole
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } } } }
      }
    });
  }

  async removeProjectMember(companyId: number, projectId: number, employeeId: number) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, companyId },
      include: { members: true }
    });
    
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_employeeId: { projectId, employeeId } }
    });

    if (!existing) {
      return { success: true };
    }

    // Handle Owner Removal Logic
    if (project.leadId === employeeId) {
      const otherMembers = project.members.filter(m => m.employeeId !== employeeId);
      
      if (otherMembers.length > 0) {
        // Try to find an Admin to transfer ownership, else just pick the first member
        const newLead = otherMembers.find(m => m.role === 'ADMIN') || otherMembers[0];
        
        await this.prisma.project.update({
          where: { id: projectId },
          data: { leadId: newLead.employeeId }
        });
        
        // Also ensure the new lead is upgraded to ADMIN role if they aren't already
        if (newLead.role !== 'ADMIN') {
          await this.prisma.projectMember.update({
            where: { id: newLead.id },
            data: { role: 'ADMIN' }
          });
        }
      } else {
        // No other members left, clear the leadId
        await this.prisma.project.update({
          where: { id: projectId },
          data: { leadId: null }
        });
      }
    }

    await this.prisma.projectMember.delete({
      where: { id: existing.id }
    });

    return { success: true };
  }

  // ── Changing a project's code (super admin) ──────────────────────────────
  //
  // The code is the prefix of every task ID on the project ("CES/0926/10-5"),
  // so it is changed together with them, in one transaction: a board never
  // shows two prefixes, and a failure leaves both exactly as they were.
  // Links use numeric ids and keep working; text that quoted an old task ID
  // (comments, exports, messages) is not rewritten. Expense claims keep the
  // code they were filed under as text but stay linked by project id.

  private normaliseProjectKey(raw: string): string {
    const key = String(raw ?? '').trim().toUpperCase();
    if (!key) throw new BadRequestException('Enter a project code');
    if (key.length > 30) throw new BadRequestException('A project code can be at most 30 characters');
    if (!/^[A-Z0-9][A-Z0-9/_.-]*$/.test(key)) {
      throw new BadRequestException('Use only letters, numbers and / _ . - in a project code');
    }
    return key;
  }

  /** What a code change would do, before anyone commits to it. */
  async previewProjectKeyChange(companyId: number, projectId: number, rawKey: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId }, select: { id: true, key: true } });
    if (!project) throw new NotFoundException('Project not found');
    const key = this.normaliseProjectKey(rawKey);
    const taskCount = await this.prisma.issue.count({ where: { projectId, key: { startsWith: `${project.key}-` } } });
    const problem = await this.projectKeyProblem(companyId, projectId, project.key, key);
    return { oldKey: project.key, newKey: key, taskCount, ok: !problem, problem };
  }

  private async projectKeyProblem(companyId: number, projectId: number, oldKey: string, key: string): Promise<string | null> {
    if (key === oldKey) return 'That is already this project\'s code';
    const taken = await this.prisma.project.findFirst({ where: { companyId, key, id: { not: projectId } }, select: { name: true } });
    if (taken) return `"${key}" is already the code of ${taken.name}`;
    // Task IDs are unique across the company, so the new prefix must be free.
    // The project's own subprojects are renamed with it, so their tasks
    // (ABC-A-1) are not a clash for the parent's new code.
    const children = await this.prisma.project.findMany({ where: { parentId: projectId }, select: { id: true } });
    const clash = await this.prisma.issue.findFirst({
      where: { companyId, key: { startsWith: `${key}-` }, projectId: { notIn: [projectId, ...children.map((c) => c.id)] } },
      select: { key: true },
    });
    if (clash) return `Task ID ${clash.key} already uses "${key}" — pick another code`;
    return null;
  }

  async changeProjectKey(companyId: number, projectId: number, rawKey: string, actorEmployeeId: number | null) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId }, select: { id: true, key: true } });
    if (!project) throw new NotFoundException('Project not found');
    const key = this.normaliseProjectKey(rawKey);
    const problem = await this.projectKeyProblem(companyId, projectId, project.key, key);
    if (problem) throw new ConflictException(problem);

    const oldKey = project.key;
    const isSub = await this.prisma.project.findFirst({ where: { id: projectId, parentId: { not: null } }, select: { id: true } });
    if (isSub) throw new BadRequestException('A subproject\'s code comes from its parent. Change its sub code instead.');
    return this.prisma.$transaction(async (tx) => {
      const tasksRenamed = await this.renameProjectKeyTx(tx, companyId, projectId, oldKey, key, actorEmployeeId);
      // Subprojects follow: ABC-A becomes NEW-A, and their tasks with them.
      const children = await tx.project.findMany({ where: { parentId: projectId }, select: { id: true, key: true, subCode: true } });
      for (const c of children) {
        if (c.subCode) await this.renameProjectKeyTx(tx, companyId, c.id, c.key, subprojectKey(key, c.subCode), actorEmployeeId);
      }
      return { oldKey, newKey: key, tasksRenamed, subprojectsRenamed: children.length };
    }, { timeout: 60000 });
  }

  /**
   * Rename one project's code and every task ID that carries it, inside the
   * caller's transaction, with an audit entry. Returns how many tasks moved.
   */
  private async renameProjectKeyTx(
    tx: any, companyId: number, projectId: number, oldKey: string, key: string, actorEmployeeId: number | null,
  ): Promise<number> {
    if (oldKey === key) return 0;
    const issues = await tx.issue.findMany({
      where: { projectId, key: { startsWith: `${oldKey}-` } },
      select: { id: true, key: true },
    });
    await tx.project.update({ where: { id: projectId }, data: { key } });
    for (const i of issues) {
      await tx.issue.update({ where: { id: i.id }, data: { key: key + i.key.slice(oldKey.length) } });
    }
    await tx.auditLog.create({
      data: {
        companyId, actorId: actorEmployeeId, action: 'PROJECT_CODE_CHANGED',
        entityType: 'Project', entityId: String(projectId),
        oldValue: { key: oldKey }, newValue: { key, tasksRenamed: issues.length },
      },
    });
    return issues.length;
  }

  // ── Subprojects ──────────────────────────────────────────────────────────
  //
  // One level: a parent (ABC) and its subprojects (ABC-A, ABC-B). Each
  // subproject is a full project — its own board, tasks, people and PM, chosen
  // by an administrator; nothing is inherited from the parent's team. Only
  // administrators create, attach or detach them.

  private assertSubprojectAdmin(role?: string) {
    if (!isCompanyAdmin(role)) throw new ForbiddenException('Only an administrator can manage subprojects.');
  }

  /** The parent, checked: real, in this company, and not itself a subproject. */
  private async loadParent(companyId: number, parentId: number) {
    const parent = await this.prisma.project.findFirst({
      where: { id: parentId, companyId, isSystem: false },
      select: {
        id: true, key: true, name: true, parentId: true, budgetMode: true, departmentId: true, category: true,
        startDate: true, endDate: true, leadContactId: true, currency: true, billingType: true, leadId: true,
      },
    });
    if (!parent) throw new NotFoundException('Parent project not found');
    if (parent.parentId) throw new BadRequestException(`${parent.name} is itself a subproject — subprojects go one level deep.`);
    return parent;
  }

  /** Whether a code is free for a project, its tasks included. */
  private async codeProblem(companyId: number, key: string, exceptProjectId?: number): Promise<string | null> {
    const taken = await this.prisma.project.findFirst({
      where: { companyId, key, ...(exceptProjectId ? { id: { not: exceptProjectId } } : {}) }, select: { name: true },
    });
    if (taken) return `"${key}" is already the code of ${taken.name}`;
    const clash = await this.prisma.issue.findFirst({
      where: { companyId, key: { startsWith: `${key}-` }, ...(exceptProjectId ? { projectId: { not: exceptProjectId } } : {}) },
      select: { key: true },
    });
    if (clash) return `Task ID ${clash.key} already uses "${key}"`;
    return null;
  }

  /**
   * A new subproject under `parentId`. Name, sub code and at least one project
   * manager are needed; dates, department, category, client and currency come
   * from the parent unless given. Under a SHARED parent it has no budget of its
   * own — it spends from the parent's.
   */
  async createSubproject(companyId: number, actorEmployeeId: number, role: string | undefined, parentId: number, data: any) {
    this.assertSubprojectAdmin(role);
    const parent = await this.loadParent(companyId, parentId);
    const subCode = normaliseSubCode(data?.subCode);
    const key = subprojectKey(parent.key, subCode);
    const problem = await this.codeProblem(companyId, key);
    if (problem) throw new ConflictException(problem);
    const pmIds: number[] = (Array.isArray(data?.pmIds) ? data.pmIds : []).map(Number).filter(Boolean);
    if (!pmIds.length) throw new BadRequestException('Assign a project manager to the subproject.');
    const memberIds: number[] = [...new Set<number>([
      ...pmIds, ...(Array.isArray(data?.memberIds) ? data.memberIds : []).map(Number),
    ])].filter(Boolean);
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);
    return this.createProject(companyId, parent.leadId ?? actorEmployeeId, {
      name: String(data?.name ?? '').trim(),
      description: data?.description,
      startDate: data?.startDate || day(parent.startDate),
      endDate: data?.endDate || day(parent.endDate),
      departmentId: data?.departmentId || parent.departmentId,
      category: data?.category || parent.category,
      leadContactId: parent.leadContactId ?? undefined,
      currency: parent.currency,
      billingType: parent.billingType,
      budgetAmount: parent.budgetMode === 'SHARED' ? null : data?.budgetAmount,
      estimatedHours: data?.estimatedHours,
      pmIds,
      memberIds,
      __subproject: { parentId: parent.id, subCode, key },
    });
  }

  /** Put an existing project under a parent. Its code, and its tasks', become PARENT-SUB. */
  async attachSubproject(companyId: number, actorEmployeeId: number | null, role: string | undefined, parentId: number, data: any) {
    this.assertSubprojectAdmin(role);
    const parent = await this.loadParent(companyId, parentId);
    const childId = Number(data?.projectId);
    if (!childId || childId === parent.id) throw new BadRequestException('Choose another project to add as a subproject.');
    const child = await this.prisma.project.findFirst({
      where: { id: childId, companyId, isSystem: false },
      select: { id: true, key: true, name: true, parentId: true, _count: { select: { subprojects: true } } },
    });
    if (!child) throw new NotFoundException('Project not found');
    if (child.parentId) throw new BadRequestException(`${child.name} is already a subproject. Detach it first.`);
    if (child._count.subprojects) {
      throw new BadRequestException(`${child.name} has subprojects of its own — subprojects go one level deep.`);
    }
    const subCode = normaliseSubCode(data?.subCode);
    const key = subprojectKey(parent.key, subCode);
    const problem = await this.codeProblem(companyId, key, child.id);
    if (problem) throw new ConflictException(problem);

    return this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: child.id }, data: { parentId: parent.id, subCode } });
      const tasksRenamed = await this.renameProjectKeyTx(tx, companyId, child.id, child.key, key, actorEmployeeId);
      return { id: child.id, oldKey: child.key, newKey: key, tasksRenamed };
    }, { timeout: 60000 });
  }

  /** Take a subproject out from under its parent. It keeps its current code. */
  async detachSubproject(companyId: number, role: string | undefined, projectId: number) {
    this.assertSubprojectAdmin(role);
    const p = await this.prisma.project.findFirst({ where: { id: projectId, companyId }, select: { id: true, parentId: true } });
    if (!p) throw new NotFoundException('Project not found');
    if (!p.parentId) throw new BadRequestException('That project is not a subproject.');
    await this.prisma.project.update({ where: { id: projectId }, data: { parentId: null, subCode: null } });
    return { detached: true };
  }

  /** Change a subproject's own part of the code: ABC-A → ABC-NORTH. */
  async changeSubCode(companyId: number, actorEmployeeId: number | null, role: string | undefined, projectId: number, rawSubCode: any) {
    this.assertSubprojectAdmin(role);
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, companyId }, select: { id: true, key: true, parent: { select: { key: true } } },
    });
    if (!p) throw new NotFoundException('Project not found');
    if (!p.parent) throw new BadRequestException('That project is not a subproject.');
    const subCode = normaliseSubCode(rawSubCode);
    const key = subprojectKey(p.parent.key, subCode);
    if (key === p.key) return { newKey: key, tasksRenamed: 0 };
    const problem = await this.codeProblem(companyId, key, p.id);
    if (problem) throw new ConflictException(problem);
    return this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: p.id }, data: { subCode } });
      const tasksRenamed = await this.renameProjectKeyTx(tx, companyId, p.id, p.key, key, actorEmployeeId);
      return { newKey: key, tasksRenamed };
    }, { timeout: 60000 });
  }

  /** SEPARATE or SHARED budgets for a parent's subprojects. */
  async setBudgetMode(companyId: number, role: string | undefined, projectId: number, rawMode: any) {
    this.assertSubprojectAdmin(role);
    const mode = normaliseBudgetMode(rawMode);
    const parent = await this.loadParent(companyId, projectId);
    await this.prisma.project.update({ where: { id: parent.id }, data: { budgetMode: mode } });
    return { budgetMode: mode };
  }

  /**
   * The parent's budget with its subprojects counted, for the Summary tab.
   * Each subproject's own figures come from the same cost roll-up the project
   * list uses, so the numbers agree everywhere.
   */
  private async subprojectBudgetRollup(companyId: number, projectId: number, own: { total: number; spent: number; loggedHours: number }) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      select: {
        budgetMode: true,
        parent: { select: { id: true, key: true, name: true, budgetMode: true } },
        subprojects: { where: { status: 'ACTIVE' }, select: { id: true, key: true, name: true, budgetAmount: true } },
      },
    });
    if (!project) return null;
    if (project.parent) {
      return { parent: project.parent, sharedBudget: project.parent.budgetMode === 'SHARED' };
    }
    if (!project.subprojects.length) return null;
    const ids = project.subprojects.map((c) => c.id);
    const [costs, extras] = await Promise.all([
      this.getCostRollupByProject(ids, companyId),
      this.prisma.projectBudgetRequest.groupBy({
        by: ['projectId'], where: { projectId: { in: ids }, companyId, status: 'APPROVED' }, _sum: { additionalBudget: true },
      }),
    ]);
    const extraBy = new Map(extras.map((e: any) => [e.projectId, e._sum.additionalBudget ?? 0]));
    const children = project.subprojects.map((c) => {
      const cost = costs.get(c.id) ?? { loggedHours: 0, employeeCost: 0, unratedHours: 0 };
      return {
        id: c.id, key: c.key, name: c.name,
        total: (c.budgetAmount ?? 0) + (extraBy.get(c.id) ?? 0),
        spent: Math.round(cost.employeeCost * 100) / 100,
        loggedHours: Math.round(cost.loggedHours * 100) / 100,
      };
    });
    const mode = project.budgetMode === 'SHARED' ? 'SHARED' : 'SEPARATE';
    return { combined: rollUpBudget(mode, own, children), subprojects: children };
  }


  async updateProject(companyId: number, id: number, data: any) {
    const project = await this.prisma.project.findUnique({
      where: { id, companyId }
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.address !== undefined) updateData.address = data.address ?? null;
    if (data.onsiteRepresentation !== undefined) updateData.onsiteRepresentation = String(data.onsiteRepresentation ?? '').trim() || null;
    if (data.color !== undefined) updateData.color = data.color;
    if (data.icon !== undefined) updateData.icon = data.icon;
    if (data.startDate !== undefined) updateData.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;
    if (data.billingType !== undefined) updateData.billingType = data.billingType;
    if (data.budgetAmount !== undefined) updateData.budgetAmount = data.budgetAmount ? parseFloat(data.budgetAmount) : null;
    if (data.hourlyRate !== undefined) updateData.hourlyRate = data.hourlyRate ? parseFloat(data.hourlyRate) : null;
    // Resolves a chosen lead contact to its Client, or takes clientId directly.
    // Left alone entirely when the payload mentions neither.
    const resolvedClientId = await this.resolveClientId(companyId, data);
    if (resolvedClientId !== undefined) updateData.clientId = resolvedClientId;
    if (data.leadContactId !== undefined) {
      updateData.leadContactId = data.leadContactId ? parseInt(data.leadContactId, 10) : null;
    }
    if (data.status !== undefined) updateData.status = data.status;
    if (data.workStatus !== undefined) updateData.workStatus = data.workStatus;
    // Delivery module fields (§4, §7, §9, §37).
    if (data.category !== undefined) updateData.category = data.category || null;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.departmentId !== undefined) updateData.departmentId = data.departmentId ? parseInt(data.departmentId, 10) : null;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.budgetNotes !== undefined) updateData.budgetNotes = data.budgetNotes || null;
    if (data.estimatedHours !== undefined) updateData.estimatedHours = data.estimatedHours ? parseFloat(data.estimatedHours) : null;
    if (data.allowManualTimeLogging !== undefined) updateData.allowManualTimeLogging = !!data.allowManualTimeLogging;
    if (data.closureStatus !== undefined) updateData.closureStatus = data.closureStatus;
    if (data.progress !== undefined) {
      // Null clears a hand-set percentage and hands progress back to the
      // task-completion calculation in getProjects — without this there is no
      // way to undo a manual override.
      updateData.progress = data.progress === null || data.progress === '' ? null : parseInt(data.progress, 10);
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: updateData
    });

    if (data.pmIds !== undefined) {
      await this.syncProjectManagers(id, data.pmIds || []);
    }
    if (data.memberIds !== undefined) {
      await this.syncProjectMembers(id, data.memberIds || []);
    }
    if (data.coordinatorIds !== undefined) await this.syncProjectRole(id, data.coordinatorIds || [], 'PROJECT_COORDINATOR');
    if (data.architectIds !== undefined) await this.syncProjectRole(id, data.architectIds || [], 'TECHNICAL_ARCHITECT');
    if (data.leadEngineerIds !== undefined) await this.syncProjectRole(id, data.leadEngineerIds || [], 'LEAD_ENGINEER');

    return updated;
  }

  private async syncProjectManagers(projectId: number, pmIds: number[]) {
    const members = await this.prisma.projectMember.findMany({ where: { projectId } });

    const currentPmIds = members.filter(m => m.role === 'PROJECT_MANAGER').map(m => m.employeeId);
    const toDowngrade = currentPmIds.filter(id => !pmIds.includes(id));
    const toPromote = pmIds.filter(id => {
      const existing = members.find(m => m.employeeId === id);
      return !existing || existing.role === 'MEMBER' || existing.role === 'VIEWER';
    });
    const toAdd = pmIds.filter(id => !members.some(m => m.employeeId === id));
    const toPromoteExisting = toPromote.filter(id => !toAdd.includes(id));

    await this.prisma.$transaction([
      ...(toDowngrade.length
        ? [this.prisma.projectMember.updateMany({
            where: { projectId, employeeId: { in: toDowngrade } },
            data: { role: 'MEMBER' }
          })]
        : []),
      ...(toPromoteExisting.length
        ? [this.prisma.projectMember.updateMany({
            where: { projectId, employeeId: { in: toPromoteExisting } },
            data: { role: 'PROJECT_MANAGER' }
          })]
        : []),
      ...(toAdd.length
        ? [this.prisma.projectMember.createMany({
            data: toAdd.map(employeeId => ({ projectId, employeeId, role: 'PROJECT_MANAGER' }))
          })]
        : [])
    ]);
  }

  /**
   * Reconcile the plain members of a project with the chosen list.
   *
   * Only ever touches MEMBER rows. The owner (ADMIN) and the project managers
   * are governed by their own fields, and a manager who also appears in the
   * assigned-users list keeps the higher role rather than being demoted by
   * this running second — which is what a blanket "set everyone in this list
   * to MEMBER" would do.
   */
  private async syncProjectMembers(projectId: number, memberIds: number[]) {
    const existing = await this.prisma.projectMember.findMany({ where: { projectId } });

    const privileged = new Set(
      existing.filter(m => m.role === 'ADMIN' || m.role === 'PROJECT_MANAGER').map(m => m.employeeId),
    );
    const wanted = memberIds.filter(id => !privileged.has(id));

    const currentMemberIds = existing.filter(m => m.role === 'MEMBER').map(m => m.employeeId);
    const toRemove = currentMemberIds.filter(id => !wanted.includes(id));
    const toAdd = wanted.filter(id => !existing.some(m => m.employeeId === id));

    await this.prisma.$transaction([
      ...(toRemove.length
        ? [this.prisma.projectMember.deleteMany({
            where: { projectId, employeeId: { in: toRemove }, role: 'MEMBER' }
          })]
        : []),
      ...(toAdd.length
        ? [this.prisma.projectMember.createMany({
            data: toAdd.map(employeeId => ({ projectId, employeeId, role: 'MEMBER' }))
          })]
        : [])
    ]);
  }

  /** Sync an optional delivery role without touching owners or project managers. */
  private async syncProjectRole(projectId: number, employeeIds: number[], role: 'PROJECT_COORDINATOR' | 'TECHNICAL_ARCHITECT' | 'LEAD_ENGINEER') {
    const existing = await this.prisma.projectMember.findMany({ where: { projectId } });
    const protectedIds = new Set(existing.filter(m => m.role === 'ADMIN' || m.role === 'PROJECT_MANAGER').map(m => m.employeeId));
    const wanted = employeeIds.map(Number).filter(id => Number.isInteger(id) && id > 0 && !protectedIds.has(id));
    const current = existing.filter(m => m.role === role).map(m => m.employeeId);
    const remove = current.filter(id => !wanted.includes(id));
    const add = wanted.filter(id => !existing.some(m => m.employeeId === id));
    await this.prisma.$transaction([
      ...(remove.length ? [this.prisma.projectMember.updateMany({ where: { projectId, employeeId: { in: remove }, role }, data: { role: 'MEMBER' } })] : []),
      ...(add.length ? [this.prisma.projectMember.createMany({ data: add.map(employeeId => ({ projectId, employeeId, role })) })] : []),
    ]);
  }

  async archiveProject(companyId: number, projectId: number, force: boolean) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId, companyId } });
    if (!project) throw new NotFoundException('Project not found');
    // The General project is where projectless tasks live. Archiving it would
    // strand every one of them.
    if (project.isSystem) throw new BadRequestException('The General project cannot be archived.');

    if (!force) {
      const activeTasksCount = await this.prisma.issue.count({
        where: {
          projectId,
          companyId,
          isArchived: false,
          status: { notIn: ['DONE', 'CANCELLED'] }
        }
      });
      if (activeTasksCount > 0) {
        throw new ConflictException({
          message: `There are ${activeTasksCount} active tasks remaining in this board.`,
          activeTasksCount
        });
      }
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'ARCHIVED' }
    });
  }

  async unarchiveProject(companyId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId }
    });
    if (!project) throw new NotFoundException('Project not found');

    return this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'ACTIVE' }
    });
  }

  /**
   * Project-wide activity feed: every issue activity in the project, newest
   * first. The rows were already being written on every status change, comment
   * and timer action — nothing surfaced them until now.
   */
  /**
   * The numbers behind the project tab strip (§ tab counts).
   *
   * One endpoint returning five counts, rather than each tab's component
   * fetching its own records to report a badge. Tickets, discussions and
   * budget requests each own their data and load it when opened; making the
   * tab strip wait for all three would mean every project opens at the speed
   * of its slowest tab to show a number nobody asked for yet.
   *
   * Counts only -- no rows leave here, so the financial visibility rule that
   * governs budget requests is not at stake: how many there are says nothing
   * about what any of them is worth.
   */
  async getTabCounts(companyId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const [tickets, discussions, budgetRequests] = await Promise.all([
      this.prisma.projectTicket.count({ where: { projectId, companyId } }),
      this.prisma.projectDiscussion.count({ where: { projectId } }),
      this.prisma.projectBudgetRequest.count({ where: { projectId, companyId } }),
    ]);

    return { tickets, discussions, budgetRequests };
  }

  async getProjectActivity(companyId: number, projectId: number, limit = 50) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId } });
    if (!project) throw new NotFoundException('Project not found');

    const activities = await this.prisma.issueActivity.findMany({
      where: { issue: { projectId, companyId } },
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        issue: { select: { id: true, title: true, key: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(limit) || 50, 1), 200),
    });

    return activities;
  }

  async getMyTimesheets(companyId: number, employeeUserId: number, startDateStr: string, endDateStr: string) {
    const employee = await this.prisma.employee.findUnique({ where: { userId: employeeUserId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    const timeLogs = await this.prisma.issueTimeLog.findMany({
      where: {
        employeeId: employee.id,
        startedAt: {
          gte: startDate,
          lte: endDate
        },
        issue: {
          companyId
        }
      },
      include: {
        issue: {
          include: {
            project: true
          }
        }
      },
      orderBy: {
        startedAt: 'desc'
      }
    });

    return timeLogs.map(log => ({
      id: log.id,
      issueId: log.issueId,
      issueKey: log.issue.key,
      issueTitle: log.issue.title,
      projectId: log.issue.projectId,
      projectName: log.issue.project.name,
      projectColor: log.issue.project.color,
      startedAt: log.startedAt,
      endedAt: log.endedAt,
      durationMin: log.durationMin
    }));
  }
}
