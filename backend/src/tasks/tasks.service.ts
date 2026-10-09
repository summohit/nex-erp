import {
  Injectable, BadRequestException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TasksGateway } from '../events/tasks/tasks.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { CrmService } from '../crm/crm.service';
import { MyTaskDto, NormalisedStatus, TaskPerson } from './dto/my-task.dto';
import { canCreateTask } from './task-permissions';
import { APPROVAL_STATE, needsApprovalOnCreate } from '../approvals/two-step-approval';
import { rankTaskPerformers, TaskPerformanceInput, TaskPerformer } from './task-performance';
import { isCompanyAdmin, isSuperAdmin } from '../common/company-roles';
import { resolveProjectViewer } from '../projects/project-roles';

/** Whose tasks a My Tasks request is asking for. 'all' is administrators only. */
/** 'created' = tasks I raised for anybody, so a PM can follow what they handed out. */
export type TaskScope = 'mine' | 'all' | 'created';

/** Board columns whose names map onto the normalised ladder. */
const STATUS_LADDER: Record<string, NormalisedStatus> = {
  TODO: 'TODO',
  IN_PROGRESS: 'IN_PROGRESS',
  IN_REVIEW: 'IN_REVIEW',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
};

/** Statuses that mean "this is off my plate". */
const CLOSED_STATUSES = ['DONE', 'CANCELLED'];

/**
 * Per source, the most rows we will pull before merging.
 *
 * Two heterogeneous tables cannot be paged in SQL together without a UNION view,
 * and one person's open task list is realistically under a hundred rows. Rather
 * than build machinery for a problem nobody has, take a generous slice and say
 * so in the response when it was not enough.
 */
const PER_SOURCE_CAP = 200;

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private tasksGateway: TasksGateway,
    private notificationsService: NotificationsService,
    private crm: CrmService,
  ) {}

  /**
   * Return each person's planned hours for a single UTC calendar date.
   *
   * An issue contributes its complete estimated-hours budget on every date in
   * its scheduled range. This is deliberately the task's total allocation —
   * not a synthetic per-day split — so a manager sees the real number of task
   * hours currently assigned to a person before selecting them.
   */
  async getAssigneeWorkload(companyId: number, dateText: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      throw new BadRequestException('A valid workload date is required.');
    }
    const dayStart = new Date(`${dateText}T00:00:00.000Z`);
    if (Number.isNaN(dayStart.getTime())) {
      throw new BadRequestException('A valid workload date is required.');
    }
    const nextDay = new Date(dayStart);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    const [issues, preSalesTasks] = await Promise.all([
      this.prisma.issue.findMany({
        where: {
          companyId,
          isArchived: false,
          status: { notIn: CLOSED_STATUSES },
          startDate: { lte: dayStart },
          dueDate: { gte: dayStart },
        },
        select: {
          assigneeId: true,
          estimatedHours: true,
          startDate: true,
          dueDate: true,
          members: { select: { employeeId: true } },
        },
      }),
      this.prisma.preSalesTask.findMany({
        where: {
          companyId,
          status: { not: 'COMPLETED' },
          scheduledAt: { gte: dayStart, lt: nextDay },
        },
        select: { assignedToId: true, estimatedMinutes: true },
      }),
    ]);

    const totals = new Map<number, number>();
    const add = (employeeId: number | null | undefined, hours: number) => {
      if (!employeeId || !Number.isFinite(hours) || hours <= 0) return;
      totals.set(employeeId, (totals.get(employeeId) ?? 0) + hours);
    };

    for (const issue of issues) {
      const totalHours = Number(issue.estimatedHours ?? 0);
      const assignees = new Set<number>([
        ...(issue.assigneeId ? [issue.assigneeId] : []),
        ...issue.members.map((member) => member.employeeId),
      ]);
      assignees.forEach((employeeId) => add(employeeId, totalHours));
    }
    for (const task of preSalesTasks) add(task.assignedToId, Number(task.estimatedMinutes ?? 0) / 60);

    return {
      date: dateText,
      hoursByEmployee: Object.fromEntries(
        [...totals.entries()].map(([employeeId, hours]) => [employeeId, Math.round(hours * 100) / 100]),
      ),
    };
  }

  // ── permissions ──────────────────────────────────────────────────────────

  /** Delegates to the shared rule — see task-permissions.ts. */
  async canCreateTask(
    companyId: number,
    actorEmployeeId: number | null,
    role: string | undefined,
    project?: { id?: number; leadId: number | null } | null,
  ): Promise<boolean> {
    return canCreateTask(this.prisma as any, companyId, actorEmployeeId, role, project);
  }

  async assertCanCreateTask(
    companyId: number,
    actorEmployeeId: number | null,
    role: string | undefined,
    project?: { id?: number; leadId: number | null } | null,
    /**
     * What was being attempted. The refusal differs because the way forward
     * differs: being made a project manager fixes one and does nothing for the
     * other, and "create tasks here" did not say which this was.
     */
    kind: 'GENERAL' | 'PROJECT' = 'PROJECT',
  ): Promise<void> {
    if (await this.canCreateTask(companyId, actorEmployeeId, role, project)) return;
    throw new ForbiddenException(
      kind === 'GENERAL'
        ? 'You do not have permission to change general tasks for other people. Ask an administrator '
          + 'to enable task creation for your department.'
        : 'You can only raise tasks in projects you own or manage. Pick one of those, or ask an '
          + 'administrator to enable task creation for your department.',
    );
  }

  /**
   * What the current user may do, answered by the server.
   *
   * The frontend needs to know whether to show an Add Task button. Having it
   * re-implement the department rule in TypeScript would mean two authorities
   * that drift; asking means flipping the flag in Master Data takes effect
   * without a frontend release.
   */
  async getCapabilities(companyId: number, actorEmployeeId: number | null, role?: string) {
    const canCreate = await this.canCreateTask(companyId, actorEmployeeId, role);

    /**
     * A project manager can raise tasks, but only inside the projects they
     * manage — and this question is asked with no project in hand, so the
     * per-project rule cannot answer it.
     *
     * "Do they manage anything at all" is the right granularity for a button:
     * it decides whether Add Task is worth showing, and createIssue still
     * checks the actual project when the form is submitted. Without this the
     * server would allow the thing the screen never offers.
     */
    const managesAProject =
      actorEmployeeId != null
        ? !!(await this.prisma.projectMember.findFirst({
            where: {
              employeeId: actorEmployeeId,
              role: 'PROJECT_MANAGER',
              project: { companyId },
            },
            select: { id: true },
          }))
        : false;

    const isAdmin = role === 'SUPERADMIN' || role === 'ADMIN';

    return {
      canCreateTask: canCreate || managesAProject,
      // General tasks: administrators and project managers only — see
      // canCreateGeneralTask. A department flag does not grant this.
      canCreateGeneral: isAdmin || managesAProject,
      /** Raise a task in ANY project: admin, or a department flagged in Master Data. */
      canCreateAnywhere: canCreate,
      isAdmin,
    };
  }

  /**
   * Who may raise a general task — one that belongs to no project and no deal.
   *
   * Administrators, and anyone who is a project manager on at least one
   * project. Deliberately not the Master Data department flag: that flag is
   * about raising work inside projects, and a general task has no project to
   * scope it, so it is limited to the people who already direct other people's
   * work. Such a task may be assigned to anybody in the company.
   */
  async canCreateGeneralTask(companyId: number, actorEmployeeId: number | null, role?: string) {
    if (role === 'SUPERADMIN' || role === 'ADMIN') return true;
    if (actorEmployeeId == null) return false;
    return !!(await this.prisma.projectMember.findFirst({
      where: { employeeId: actorEmployeeId, role: 'PROJECT_MANAGER', project: { companyId } },
      select: { id: true },
    }));
  }

  // ── the General project ──────────────────────────────────────────────────

  /**
   * The company's one hidden project for work that belongs to no project.
   *
   * Created lazily as well as in the migration, because companies created after
   * the migration would otherwise have nowhere to put a general task. Anything
   * that lists projects to a human must filter `isSystem: false` — see the
   * comment on Project.isSystem.
   */
  async ensureGeneralProject(companyId: number) {
    const existing = await this.prisma.project.findFirst({
      where: { companyId, isSystem: true },
      select: { id: true, key: true, leadId: true },
    });
    if (existing) return existing;

    const project = await this.prisma.project.create({
      data: {
        name: 'General',
        key: 'GEN',
        description: 'Tasks that do not belong to a project. Hidden from project lists.',
        isSystem: true,
        companyId,
        boards: {
          create: {
            name: 'Main Board',
            columns: {
              create: [
                { name: 'To Do', color: '#6b7280', position: 0, isSystem: true, type: 'TODO' },
                { name: 'In Progress', color: '#3b82f6', position: 1, isSystem: true, type: 'IN_PROGRESS' },
                { name: 'In Review', color: '#8b5cf6', position: 2, isSystem: true, type: 'REVIEW' },
                { name: 'Done', color: '#22c55e', position: 3, isSystem: true, type: 'DONE' },
                { name: 'Archived', color: '#9ca3af', position: 4, isSystem: true, type: 'DONE' },
              ],
            },
          },
        },
      },
      select: { id: true, key: true, leadId: true },
    });
    return project;
  }

  // ── keys ─────────────────────────────────────────────────────────────────

  /**
   * The next key for a project, allocated without a race.
   *
   * The old `${key}-${count + 1}` read the row count and then wrote, so two
   * people creating a task in the same second got the same number and the
   * second hit @@unique([key, companyId]) as a 500. A count also reuses a key
   * after a deletion. Incrementing a column row-locks it, so concurrent callers
   * are serialised by the database and each gets its own number.
   *
   * Takes a transaction client so the allocation commits or rolls back with the
   * task it belongs to.
   */
  private async allocateKey(tx: any, projectId: number, projectKey: string): Promise<string> {
    const { issueSeq } = await tx.project.update({
      where: { id: projectId },
      data: { issueSeq: { increment: 1 } },
      select: { issueSeq: true },
    });
    return `${projectKey}-${issueSeq}`;
  }

  // ── dependencies ─────────────────────────────────────────────────────────

  /**
   * Refuse a dependency that would close a loop.
   *
   * One query for the company's whole BLOCKS graph — the table stays small —
   * then a breadth-first walk from the proposed blocker. If the blocked task is
   * reachable from it, adding the edge would make a cycle. The hop cap is a
   * belt-and-braces guard: the visited set already terminates the walk.
   */
  async assertNoDependencyCycle(companyId: number, issueId: number, dependsOnIssueId: number) {
    if (issueId === dependsOnIssueId) {
      throw new BadRequestException('A task cannot depend on itself.');
    }

    const edges = await this.prisma.issueDependency.findMany({
      where: { companyId, type: 'BLOCKS' },
      select: { issueId: true, dependsOnIssueId: true },
    });

    const dependsOn = new Map<number, number[]>();
    for (const e of edges) {
      const list = dependsOn.get(e.issueId) ?? [];
      list.push(e.dependsOnIssueId);
      dependsOn.set(e.issueId, list);
    }

    const seen = new Set<number>();
    let frontier = [dependsOnIssueId];
    let hops = 0;
    while (frontier.length && hops++ < 200) {
      const next: number[] = [];
      for (const node of frontier) {
        if (node === issueId) {
          throw new BadRequestException('That would create a circular dependency.');
        }
        if (seen.has(node)) continue;
        seen.add(node);
        next.push(...(dependsOn.get(node) ?? []));
      }
      frontier = next;
    }
  }

  // ── assignees ────────────────────────────────────────────────────────────

  /**
   * Keep `assigneeId` and the member list in step.
   *
   * `assigneeId` is load-bearing: assertCanCompleteOrArchive, the manager
   * chain, the review flow and the reminder cron all reason about exactly one
   * person. So the first selected assignee stays the primary — the one whose
   * manager approves completion — and everyone selected, including that one,
   * becomes a member. The invariant is `assigneeId ∈ members`, and this is the
   * only place that maintains it.
   */
  private async syncAssignees(tx: any, issueId: number, assigneeIds: number[]) {
    const unique = [...new Set(assigneeIds.filter(Boolean).map(Number))];
    await tx.issue.update({
      where: { id: issueId },
      data: { assigneeId: unique[0] ?? null },
    });
    await tx.issueMember.deleteMany({ where: { issueId } });
    if (unique.length) {
      await tx.issueMember.createMany({
        data: unique.map((employeeId) => ({ issueId, employeeId })),
        skipDuplicates: true,
      });
    }
    return unique;
  }

  /**
   * The estimate and the dates, checked together.
   *
   * Hours are required and must be positive: an unestimated task cannot be
   * planned, and zero is the value people type to get past a required box.
   * Both dates are required for the same reason a plan needs them, and the end
   * cannot precede the start. Compared as calendar days rather than instants,
   * because the form sends plain dates and "due the same day it starts" is a
   * normal one-day task.
   *
   * Applied on the server as well as the form: the form is a courtesy, and the
   * API is also reachable from the mobile app.
   */
  private assertValidSchedule(data: {
    parentKind?: string; startDate?: string; dueDate?: string; estimatedHours?: number | string | null;
  }) {
    const hours = Number(data.estimatedHours);
    if (data.estimatedHours == null || data.estimatedHours === '' || !Number.isFinite(hours) || hours <= 0) {
      throw new BadRequestException('Enter the estimated hours — it must be greater than zero.');
    }

    const parse = (v?: string) => {
      const d = v ? new Date(v) : null;
      return d && !Number.isNaN(d.getTime()) ? d : null;
    };
    const start = parse(data.startDate);
    const due = parse(data.dueDate);
    if (!start) throw new BadRequestException('Choose a start date.');
    if (!due) throw new BadRequestException('Choose a due date.');

    const day = (d: Date) => d.toISOString().slice(0, 10);
    if (day(due) < day(start)) {
      throw new BadRequestException('The due date cannot be before the start date.');
    }
  }

  // ── creating a task ──────────────────────────────────────────────────────

  /**
   * Raise a task against a project, a deal, or nothing at all.
   *
   * Everything lands in one transaction. The board's inline composer creates a
   * bare card and lets the user fill the rest in through per-field popovers —
   * that works because the card is already on screen. A form that collects
   * assignees, labels, a checklist and a dependency up front cannot do that
   * without leaving a half-built task behind whenever the fourth request fails.
   *
   * Sockets and notifications fire AFTER the commit. Emitting inside a
   * transaction announces work that may still roll back.
   */
  async createTask(
    companyId: number,
    reporterId: number,
    role: string | undefined,
    data: {
      title: string;
      description?: string;
      parentKind?: 'PROJECT' | 'LEAD' | 'GENERAL';
      projectId?: number;
      leadId?: number;
      taskTypeId?: number;
      phaseId?: number;
      priority?: string;
      status?: string;
      startDate?: string;
      dueDate?: string;
      estimatedHours?: number;
      assigneeIds?: number[];
      labelIds?: number[];
      dependsOnIssueIds?: number[];
      checklists?: { title: string; items?: string[] }[];
      attachments?: { fileName: string; fileUrl: string; fileSize?: number }[];
      /** Work already completed by the employee raising this task. */
      initialTimeLog?: { startedAt: string; endedAt: string; note?: string };
    },
  ) {
    if (!data?.title?.trim()) throw new BadRequestException('A task needs a title.');
    this.assertValidSchedule(data);

    let initialTimeLog: { startedAt: Date; endedAt: Date; durationMin: number; note: string | null } | null = null;
    if (data.initialTimeLog) {
      const startedAt = new Date(data.initialTimeLog.startedAt);
      const endedAt = new Date(data.initialTimeLog.endedAt);
      if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || endedAt <= startedAt) {
        throw new BadRequestException('The work log end must be after its start.');
      }
      const durationMin = Math.round((endedAt.getTime() - startedAt.getTime()) / 60000);
      if (durationMin < 1) throw new BadRequestException('A work log must be at least one minute.');
      initialTimeLog = {
        startedAt, endedAt, durationMin,
        note: String(data.initialTimeLog.note ?? '').trim() || null,
      };
    }

    // Resolve where it lives. A lead-linked or general task goes in the hidden
    // General project, which is what gives it a key, a column and a detail view.
    let project: { id: number; key: string; leadId: number | null };
    if (data.parentKind === 'PROJECT') {
      if (!data.projectId) throw new BadRequestException('Choose a project.');
      const found = await this.prisma.project.findFirst({
        where: { id: Number(data.projectId), companyId },
        select: { id: true, key: true, leadId: true },
      });
      if (!found) throw new NotFoundException('Project not found');
      project = found;
    } else {
      project = await this.ensureGeneralProject(companyId);
    }

    const assigneeIds = [...new Set((data.assigneeIds ?? []).map(Number).filter(Boolean))];

    if (data.parentKind === 'PROJECT') {
      await this.assertCanCreateTask(companyId, reporterId, role, project, 'PROJECT');
    } else if (!(await this.canCreateGeneralTask(companyId, reporterId, role))) {
      throw new ForbiddenException(
        'Only administrators and project managers can create general tasks.',
      );
    }

    if (initialTimeLog && data.estimatedHours != null && initialTimeLog.durationMin > Number(data.estimatedHours) * 60) {
      throw new BadRequestException('The logged time cannot exceed this task\'s estimated hours.');
    }

    if (initialTimeLog) {
      const manualLogging = await this.prisma.project.findUnique({
        where: { id: project.id }, select: { allowManualTimeLogging: true, name: true },
      });
      if (manualLogging && !manualLogging.allowManualTimeLogging) {
        throw new BadRequestException(`${manualLogging.name} does not allow manual time entry. Use the timer after creating the task.`);
      }
    }

    // §PB8: the same approval a task raised from the board gets. This is a
    // second creation path into the same Issue table, so the rule has to be
    // applied here too — otherwise the Add Task modal is simply a way around
    // it, and an approval anybody can sidestep is not an approval.
    //
    // A lead-linked task lands in the hidden General project, which has no
    // technical architect to review it and no delivery to protect, so it is
    // never held. General tasks have their own, admin-only rule below.
    const creator = await resolveProjectViewer(
      this.prisma as any, companyId, project.id, reporterId, role,
    );
    const projectApproval = data.parentKind === 'PROJECT' && needsApprovalOnCreate(creator);

    // A general task raised by a project manager waits for an administrator.
    // There is no technical architect over the General workspace, so it
    // starts at the admin step. An administrator's own goes straight in.
    const isGeneral = data.parentKind !== 'PROJECT' && data.parentKind !== 'LEAD' && !data.leadId;
    const generalApproval = isGeneral && !isCompanyAdmin(role);

    const approvalNeeded = projectApproval || generalApproval;
    const initialApproval = generalApproval ? APPROVAL_STATE.PENDING_ADMIN : APPROVAL_STATE.PENDING_TECHNICAL;

    if (data.leadId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: Number(data.leadId), companyId },
        select: { id: true },
      });
      if (!lead) throw new NotFoundException('Deal not found');
    }

    // Validated before the transaction opens: a brand-new task cannot be part
    // of a cycle, but a blocker id that does not exist still has to be caught.
    // §8: a new task belongs to a phase -- the same rule the board enforces,
    // and for the same reason it is conditional there: a company with no
    // active phases would otherwise lose task creation altogether.
    //
    // Only for a task that belongs to a project. A phase is a stage of a
    // project's delivery; a general task has no delivery to be in a stage of,
    // and the form does not offer the field there. Demanding it anyway made
    // General tasks impossible to create in any company that had phases.
    if (data.parentKind === 'PROJECT' && !data.phaseId) {
      const phasesExist = await this.prisma.projectPhase.count({
        where: { companyId, isActive: true },
      });
      if (phasesExist > 0) {
        throw new BadRequestException('Choose the project phase this task belongs to.');
      }
    }

    const dependsOn = [...new Set((data.dependsOnIssueIds ?? []).map(Number).filter(Boolean))];
    if (dependsOn.length) {
      const found = await this.prisma.issue.findMany({
        where: { id: { in: dependsOn }, companyId },
        select: { id: true },
      });
      if (found.length !== dependsOn.length) {
        throw new BadRequestException('One of the blocking tasks no longer exists.');
      }
    }

    const firstColumn = await this.prisma.boardColumn.findFirst({
      where: { board: { projectId: project.id } },
      orderBy: { position: 'asc' },
      select: { id: true },
    });

    const issue = await this.prisma.$transaction(async (tx) => {
      const key = await this.allocateKey(tx, project.id, project.key);

      const last = await tx.issue.findFirst({
        where: { columnId: firstColumn?.id ?? undefined },
        orderBy: { position: 'desc' },
        select: { position: true },
      });

      const created = await tx.issue.create({
        data: {
          key,
          title: data.title.trim(),
          description: data.description ?? null,
          type: 'TASK',
          status: data.status || 'TODO',
          priority: data.priority || 'MEDIUM',
          projectId: project.id,
          leadId: data.leadId ? Number(data.leadId) : null,
          taskTypeId: data.taskTypeId ? Number(data.taskTypeId) : null,
          // §8: the delivery phase the task belongs to.
          // A general task has no project to be in a phase of, so a stray
          // phaseId from a stale client is dropped rather than stored.
          phaseId: data.parentKind === 'PROJECT' && data.phaseId ? Number(data.phaseId) : null,
          companyId,
          columnId: firstColumn?.id ?? null,
          reporterId,
          position: last ? last.position + 1 : 0,
          startDate: data.startDate ? new Date(data.startDate) : null,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          estimatedHours: data.estimatedHours != null ? Number(data.estimatedHours) : null,
          workStartedAt: initialTimeLog?.startedAt ?? null,
          approvalState: approvalNeeded ? initialApproval : null,
          approvalRequestedById: approvalNeeded ? reporterId : null,
        },
      });

      const assignees = await this.syncAssignees(tx, created.id, assigneeIds);

      if (initialTimeLog) {
        await tx.issueTimeLog.create({
          data: {
            issueId: created.id,
            employeeId: reporterId,
            startedAt: initialTimeLog.startedAt,
            endedAt: initialTimeLog.endedAt,
            durationMin: initialTimeLog.durationMin,
            source: 'MANUAL',
            note: initialTimeLog.note,
          },
        });
      }

      // An assignee who is not on the project cannot see the project the task
      // lives in — getProjects filters non-admins by membership. The board's
      // toggleIssueMember already does this; creation has to as well.
      if (assignees.length) {
        await tx.projectMember.createMany({
          data: assignees.map((employeeId) => ({ projectId: project.id, employeeId })),
          skipDuplicates: true,
        });
      }

      if (data.labelIds?.length) {
        await tx.issueLabel.createMany({
          data: [...new Set(data.labelIds.map(Number))].map((labelId) => ({ issueId: created.id, labelId })),
          skipDuplicates: true,
        });
      }

      if (dependsOn.length) {
        await tx.issueDependency.createMany({
          data: dependsOn.map((dependsOnIssueId) => ({
            issueId: created.id, dependsOnIssueId, companyId, createdById: reporterId,
          })),
          skipDuplicates: true,
        });
      }

      for (const list of data.checklists ?? []) {
        if (!list?.title?.trim()) continue;
        const checklist = await tx.checklist.create({
          data: { title: list.title.trim(), issueId: created.id },
        });
        const items = (list.items ?? []).map((t) => t?.trim()).filter(Boolean) as string[];
        if (items.length) {
          await tx.checklistItem.createMany({
            data: items.map((title) => ({ title, checklistId: checklist.id })),
          });
        }
      }

      if (data.attachments?.length) {
        await tx.issueAttachment.createMany({
          data: data.attachments.map((a) => ({
            fileName: a.fileName, fileUrl: a.fileUrl, fileSize: a.fileSize ?? null,
            fileType: 'FILE', issueId: created.id, uploadedBy: reporterId,
          })),
        });
      }

      await tx.issueActivity.create({
        data: { action: 'CREATED', issueId: created.id, actorId: reporterId },
      });

      return created;
    });

    this.tasksGateway.emitIssueUpdated(issue.id, project.id, issue);
    await this.notificationsService.notifyEmployees(assigneeIds, {
      companyId,
      title: `New task: ${issue.title}`,
      message: `${issue.key} has been assigned to you.`,
      type: 'TASK_ASSIGNED',
      linkUrl: `/projects/${project.id}?task=${issue.id}`,
      excludeEmployeeId: reporterId,
    });

    return issue;
  }

  // ── My Tasks ─────────────────────────────────────────────────────────────

  /** Board column names are free text; map what we recognise, default to TODO. */
  private normaliseIssueStatus(status: string | null): NormalisedStatus {
    const key = (status ?? '').toUpperCase().replace(/[\s-]+/g, '_');
    return STATUS_LADDER[key] ?? 'TODO';
  }

  /**
   * Everything assigned to one person, across projects, the General project and
   * pre-sales, in one list.
   *
   * `reporterId` is deliberately not included by default: the dashboard widget
   * folds in tasks you raised for other people, which answers a different
   * question from "what do I have to do". It is available behind a flag.
   *
   * `scope: 'all'` widens the list to every task in the company. It is the
   * answer to "why can an administrator not see anything here" — the ownership
   * filter was unconditional, so an admin with nothing assigned to them saw an
   * empty screen while the company had a hundred open tasks. The role check is
   * HERE rather than in the controller because this method is also called from
   * the dashboard; a non-admin asking for 'all' is quietly given their own
   * list rather than an error, since the toggle is not offered to them.
   */
  async getMyTasks(
    companyId: number,
    employeeId: number,
    role: string | undefined,
    opts: { includeReported?: boolean; includeDone?: boolean; scope?: TaskScope; assigneeId?: number } = {},
  ): Promise<{ items: MyTaskDto[]; truncated: boolean; scope: TaskScope }> {
    const everyone = opts.scope === 'all' && (role === 'SUPERADMIN' || role === 'ADMIN');
    // One person's work inside the company-wide view. Applied here, before the
    // per-source cap: filtering after it hid anybody whose tasks were not in
    // the first 200 — an admin looking for HR's tasks found nobody to pick.
    const onePerson = everyone && Number.isInteger(opts.assigneeId) && (opts.assigneeId as number) > 0
      ? (opts.assigneeId as number) : null;
    // Anyone may see what they themselves raised; no role check needed.
    const created = !everyone && opts.scope === 'created';

    const mine: any[] = [
      { assigneeId: employeeId },
      { members: { some: { employeeId } } },
    ];
    if (opts.includeReported) mine.push({ reporterId: employeeId });

    const issues = await this.prisma.issue.findMany({
      where: {
        companyId,
        isArchived: false,
        ...(opts.includeDone ? {} : { status: { notIn: CLOSED_STATUSES } }),
        ...(everyone
          ? (onePerson ? { OR: [{ assigneeId: onePerson }, { members: { some: { employeeId: onePerson } } }] } : {})
          : created ? { reporterId: employeeId } : { OR: mine }),
      },
      select: {
        id: true, key: true, title: true, status: true, priority: true,
        createdAt: true, startDate: true, dueDate: true, estimatedHours: true,
        // §PB8: so a manager can see their own task is not work yet, and read
        // why it came back if it was sent back.
        approvalState: true,
        approvalRejectionReason: true,
        project: { select: { id: true, name: true, key: true, isSystem: true } },
        // §17: the task list filters by project code and by milestone, and
        // both are cheap joins the row already half-carries.
        milestone: { select: { id: true, name: true } },
        lead: { select: { id: true, title: true, leadCode: true, companyName: true, contactName: true, flow: true } },
        taskType: { select: { name: true } },
        phase: { select: { id: true, name: true } },
        // §6: the ticket this task was converted from, if any.
        projectTicket: { select: { id: true, ticketNumber: true } },
        assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        _count: { select: { attachments: true } },
        members: {
          select: {
            employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          },
        },
        blockedBy: {
          where: { type: 'BLOCKS' },
          select: {
            dependsOnIssue: { select: { id: true, key: true, title: true, status: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PER_SOURCE_CAP,
    });

    const now = new Date();
    const items: MyTaskDto[] = issues.map((i) => {
      const assignees: TaskPerson[] = i.members.length
        ? i.members.map((m) => m.employee)
        : i.assignee
          ? [i.assignee]
          : [];
      const general = i.project?.isSystem === true;
      const leadName = i.lead
        ? (i.lead.title
            ? (i.lead.companyName ? `${i.lead.title} (${i.lead.companyName})` : i.lead.title)
            : (i.lead.companyName || i.lead.contactName || (i.lead.leadCode ? `Deal ${i.lead.leadCode}` : 'Deal')))
        : 'Deal';
      const parent = general
        ? i.lead
          ? { kind: 'LEAD' as const, id: i.lead.id, name: leadName }
          : { kind: 'GENERAL' as const, id: 0, name: 'General' }
        : { kind: 'PROJECT' as const, id: i.project!.id, name: i.project!.name };

      return {
        approvalState: i.approvalState ?? null,
        approvalRejectionReason: i.approvalRejectionReason ?? null,
        source: general ? 'GENERAL' : 'PROJECT',
        id: i.id,
        refKey: i.key,
        title: i.title,
        status: this.normaliseIssueStatus(i.status),
        rawStatus: i.status,
        priority: i.priority,
        taskType: i.taskType?.name ?? null,
        // §8: both id and name -- the name renders, the id drives the filter.
        ticketNumber: i.projectTicket?.ticketNumber ?? null,
        phaseId: i.phase?.id ?? null,
        phase: i.phase?.name ?? null,
        // Null on a general or deal task, which has no project to code.
        projectCode: general ? null : (i.project?.key ?? null),
        milestone: i.milestone ? { id: i.milestone.id, name: i.milestone.name } : null,
        startDate: i.startDate,
        dueDate: i.dueDate,
        estimatedHours: i.estimatedHours,
        evidenceCount: i._count.attachments,
        createdAt: i.createdAt ?? null,
        // The project the issue lives in — null on a pre-sales task, and the
        // system project on a general one. Drives i) the room the row joins so
        // board changes reach it and ii) the status dropdown's write, both of
        // which need a real project id that `parent` deliberately hides.
        projectId: i.project?.id ?? null,
        assignees,
        parent,
        blockedBy: i.blockedBy
          .filter((d) => !CLOSED_STATUSES.includes(d.dependsOnIssue.status))
          .map((d) => ({ id: d.dependsOnIssue.id, refKey: d.dependsOnIssue.key, title: d.dependsOnIssue.title })),
        isOverdue: !!i.dueDate && i.dueDate < now,
        link: { route: `/projects/${i.project!.id}`, queryParams: { task: String(i.id) } },
      };
    });

    // Pre-sales rows come from CrmService, never from prisma.preSalesTask here.
    // That module owns what a pre-sales viewer is allowed to see, and routing
    // through it keeps the financial masking in one place.
    const preSales = await this.crm.getMyPreSalesTasks(companyId, employeeId, {
      includeDone: opts.includeDone === true,
      take: PER_SOURCE_CAP,
      everyone,
      createdBy: created,
      isAdmin: role === 'SUPERADMIN' || role === 'ADMIN',
    });

    const all = [
      ...items,
      ...(onePerson
        ? preSales.filter((t: any) => (t.assignees || []).some((a: any) => a?.id === onePerson) || t.assignee?.id === onePerson)
        : preSales),
    ];
    // Newest first: what was assigned most recently earns the top of the list
    // and undated rows trail behind rather than jumping the queue. This is the
    // answer to "my board work is beside my deal work" — both halves of the
    // list read newest → oldest instead of each sorting by deadline.
    all.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

    return {
      items: all,
      truncated: issues.length >= PER_SOURCE_CAP || preSales.length >= PER_SOURCE_CAP,
      // Echoed back so the UI reflects what it actually got rather than what it
      // asked for — a non-admin who sends scope=all is answered with 'mine'.
      scope: everyone ? 'all' : created ? 'created' : 'mine',
    };
  }

  // ── dependency edges ─────────────────────────────────────────────────────

  async addDependency(
    companyId: number,
    actorEmployeeId: number,
    role: string | undefined,
    issueId: number,
    dependsOnIssueId: number,
  ) {
    if (!dependsOnIssueId) throw new BadRequestException('Choose a task to depend on.');

    const both = await this.prisma.issue.findMany({
      where: { id: { in: [issueId, dependsOnIssueId] }, companyId },
      select: { id: true, projectId: true, project: { select: { leadId: true } } },
    });
    if (both.length !== 2) throw new NotFoundException('Task not found');

    const target = both.find((i) => i.id === issueId)!;
    await this.assertCanCreateTask(companyId, actorEmployeeId, role, target.project);
    await this.assertNoDependencyCycle(companyId, issueId, dependsOnIssueId);

    return this.prisma.issueDependency.upsert({
      where: { issueId_dependsOnIssueId: { issueId, dependsOnIssueId } },
      update: {},
      create: { issueId, dependsOnIssueId, companyId, createdById: actorEmployeeId },
    });
  }

  async removeDependency(companyId: number, issueId: number, dependencyId: number) {
    const { count } = await this.prisma.issueDependency.deleteMany({
      where: { id: dependencyId, issueId, companyId },
    });
    if (!count) throw new NotFoundException('Dependency not found');
    return { removed: true };
  }

  /**
   * Open blockers on a task, for the warning shown when it is moved on.
   *
   * Advisory everywhere except the move into Review or Done, where an open
   * blocker means the task demonstrably is not finished. Anywhere else a stale
   * blocker nobody closed must not be able to stop real work.
   */
  async openBlockers(companyId: number, issueId: number) {
    const rows = await this.prisma.issueDependency.findMany({
      where: { issueId, companyId, type: 'BLOCKS' },
      select: { dependsOnIssue: { select: { id: true, key: true, title: true, status: true } } },
    });
    return rows
      .map((r) => r.dependsOnIssue)
      .filter((i) => !CLOSED_STATUSES.includes(i.status));
  }

  /**
   * Who has been delivering tasks well, over the last 30 days (§Tasks1).
   *
   * Rolling rather than calendar month: on the first of a month a calendar
   * board is empty, which is the moment it most needs to say something.
   *
   * Project work only. General tasks live in the hidden General project and
   * are mostly small admin, and pre-sales tasks run through their own hours
   * flow — counting either means whoever files the most trivia wins, which
   * rewards precisely the wrong thing.
   */
  async getTopTaskPerformers(
    companyId: number, role: string | undefined, windowDays = 30, limit = 3,
  ): Promise<{ performers: TaskPerformer[]; windowDays: number; since: Date }> {
    if (!isSuperAdmin(role)) {
      throw new ForbiddenException('Only a Super Admin can see task performance.');
    }

    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    const done = await this.prisma.issue.findMany({
      where: {
        companyId,
        status: 'DONE',
        completedAt: { gte: since },
        isArchived: false,
        // Real delivery only — see the note above.
        project: { isSystem: false },
        leadId: null,
      },
      select: {
        completedAt: true,
        dueDate: true,
        members: { select: { employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } } },
        assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });

    // Credited to everybody on the task, not just a single assignee: the board
    // supports several members and crediting only one would make shared work
    // invisible for the rest.
    const byPerson = new Map<number, TaskPerformanceInput>();

    for (const issue of done) {
      const people = issue.members.length
        ? issue.members.map((m) => m.employee)
        : issue.assignee ? [issue.assignee] : [];

      for (const person of people) {
        if (!person) continue;
        const row = byPerson.get(person.id) ?? {
          employeeId: person.id,
          name: `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() || `Employee ${person.id}`,
          avatarUrl: person.avatarUrl ?? null,
          completed: 0, onTime: 0, withDueDate: 0,
        };

        row.completed += 1;
        if (issue.dueDate) {
          row.withDueDate += 1;
          // Finished on the due date still counts as on time: a deadline is a
          // day, not an instant.
          const due = new Date(issue.dueDate);
          due.setHours(23, 59, 59, 999);
          if (issue.completedAt && issue.completedAt <= due) row.onTime += 1;
        }
        byPerson.set(person.id, row);
      }
    }

    return {
      performers: rankTaskPerformers([...byPerson.values()], limit),
      windowDays,
      since,
    };
  }

}
