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

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  constructor(
    private prisma: PrismaService,
    private crm: CrmService,
  ) {}

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
    const finalKey = `${baseKey}${nextSeq}`;

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
        companyId,
        leadId,
        members: {
          // One row per person, highest role wins. The owner is ADMIN, the
          // chosen managers are PROJECT_MANAGER, and everyone else assigned to
          // the project is MEMBER — de-duplicated, because ProjectMember is
          // unique on (projectId, employeeId) and somebody picked as both a
          // manager and a user would otherwise fail the insert.
          create: buildInitialMembers(leadId, data.pmIds, data.memberIds)
        },
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
       */
      const existing = await this.prisma.issue.count({
        where: { projectId: project.id, companyId },
      });

      await this.prisma.issue.createMany({
        data: defaults.map((t, index) => ({
          key: `${project.key}-${existing + index + 1}`,
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
          position: existing + index,
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
            key: { in: defaults.map((_, i) => `${project.key}-${existing + i + 1}`) },
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
        data: { issueSeq: existing + defaults.length },
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
          for (const row of buildInitialMembers(project.leadId!, data.pmIds, data.memberIds)) {
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
          companyId,
          leadId,
          status: 'DRAFT',
          onboardingStatus: 'DRAFT',
          budgetAmount: data.budgetAmount ? parseFloat(data.budgetAmount) : null,
          startDate: data.startDate ? new Date(data.startDate) : null,
          endDate: data.endDate ? new Date(data.endDate) : null,
          clientId: autoClient.id,

          members: {
            create: [
              { employeeId: leadId, role: 'ADMIN' },
              ...(data.pmIds ? data.pmIds.map((id: number) => ({ employeeId: id, role: 'PROJECT_MANAGER' })) : [])
            ]
          },
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

    let position = 0;
    const issues = analysis.wbsTasks.map((task, idx) => {
      return {
        title: task.task,
        description: task.description || '',
        projectId: project.id,
        columnId: todoColumn.id,
        type: 'TASK',
        status: 'TODO',
        key: `${project.key}-${idx + 1}`,
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
    const isAdmin = role === 'SUPERADMIN' || role === 'ADMIN';
    // isSystem excludes the hidden "General" project, which exists only to give
    // projectless tasks a key, a board column and a detail screen. It is not a
    // project anybody works on and must never appear in a board list.
    const whereClause: any = { companyId, status: 'ACTIVE', isSystem: false };
    
    const emp = await this.prisma.employee.findUnique({ where: { userId } });
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
          select: { members: true, issues: true, milestones: true }
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
        issues: {
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

    const rows = await this.prisma.$queryRaw<
      { projectId: number; minutes: bigint | null; cost: number | null; unratedMinutes: bigint | null }[]
    >`
      SELECT i."projectId"                        AS "projectId",
             SUM(COALESCE(t."durationMin", 0))    AS minutes,
             SUM(COALESCE(t."durationMin", 0) / 60.0
                 * COALESCE(e."hourlyCostRate", 0)) AS cost,
             SUM(CASE WHEN e."hourlyCostRate" IS NULL
                      THEN COALESCE(t."durationMin", 0) ELSE 0 END) AS "unratedMinutes"
        FROM "IssueTimeLog" t
        JOIN "Issue" i    ON i.id = t."issueId"
        JOIN "Employee" e ON e.id = t."employeeId"
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
    const isAdmin = role === 'SUPERADMIN' || role === 'ADMIN';
    const whereClause: any = { companyId, status: 'ARCHIVED', isSystem: false };
    
    const emp = await this.prisma.employee.findUnique({ where: { userId } });
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
          select: { members: true, issues: true }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });
  }

  async getProjectDetails(companyId: number, projectId: number, userId: number, role: string) {
    const isAdmin = role === 'SUPERADMIN' || role === 'ADMIN';

    if (!isAdmin) {
      const emp = await this.prisma.employee.findUnique({ where: { userId } });
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
        }
      }
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  async getProjectSummary(companyId: number, projectId: number) {
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
        where: { projectId, companyId, isArchived: false, status: 'DONE', updatedAt: { gte: sevenDaysAgo } }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, isArchived: false, updatedAt: { gte: sevenDaysAgo } }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, isArchived: false, createdAt: { gte: sevenDaysAgo } }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, isArchived: false, dueDate: { gte: new Date(), lte: sevenDaysFromNow }, status: { not: 'DONE' } }
      }),
      this.prisma.issue.groupBy({
        by: ['status'],
        where: { projectId, companyId, isArchived: false },
        _count: { _all: true }
      }),
      this.prisma.issueMember.groupBy({
        by: ['employeeId'],
        where: { issue: { projectId, companyId, isArchived: false } },
        _count: { _all: true }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, isArchived: false, members: { none: {} } }
      }),
      this.prisma.issue.groupBy({
        by: ['priority'],
        where: { projectId, companyId, isArchived: false },
        _count: { _all: true }
      }),
      this.prisma.issueActivity.findMany({
        where: { issue: { projectId, companyId } },
        include: {
          actor: { select: { firstName: true, lastName: true, avatarUrl: true } },
          issue: { select: { id: true, key: true, title: true, status: true, type: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      }),
      this.prisma.issue.groupBy({
        by: ['type'],
        where: { projectId, companyId, isArchived: false },
        _count: { _all: true }
      }),
      this.prisma.issue.aggregate({
        _sum: { estimatedHours: true },
        where: { projectId, companyId, isArchived: false }
      }),
      this.prisma.issueTimeLog.aggregate({
        _sum: { durationMin: true },
        where: { issue: { projectId, companyId } }
      }),
      this.prisma.issue.findMany({
        where: { 
          projectId, companyId, isArchived: false,
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

    return {
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

    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_employeeId: { projectId, employeeId } }
    });

    if (existing) {
      return existing; // Already a member
    }

    return this.prisma.projectMember.create({
      data: {
        projectId,
        employeeId,
        role
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
