import {
  Injectable, BadRequestException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TasksGateway } from '../events/tasks/tasks.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { CrmService } from '../crm/crm.service';
import { MyTaskDto, NormalisedStatus, TaskPerson } from './dto/my-task.dto';
import { canCreateTask } from './task-permissions';

/** Whose tasks a My Tasks request is asking for. 'all' is administrators only. */
export type TaskScope = 'mine' | 'all';

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
  ): Promise<void> {
    if (await this.canCreateTask(companyId, actorEmployeeId, role, project)) return;
    throw new ForbiddenException(
      'You do not have permission to create tasks here. A project manager can raise tasks ' +
      'inside a project they manage; otherwise ask an administrator to enable it for your department.',
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
      !canCreate && actorEmployeeId != null
        ? !!(await this.prisma.projectMember.findFirst({
            where: {
              employeeId: actorEmployeeId,
              role: 'PROJECT_MANAGER',
              project: { companyId },
            },
            select: { id: true },
          }))
        : false;

    return {
      canCreateTask: canCreate || managesAProject,
      // General tasks belong to no project, so managing one grants nothing here.
      canCreateGeneral: canCreate,
      isAdmin: role === 'SUPERADMIN' || role === 'ADMIN',
    };
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
    },
  ) {
    if (!data?.title?.trim()) throw new BadRequestException('A task needs a title.');

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

    await this.assertCanCreateTask(companyId, reporterId, role, project);

    if (data.leadId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: Number(data.leadId), companyId },
        select: { id: true },
      });
      if (!lead) throw new NotFoundException('Deal not found');
    }

    // Validated before the transaction opens: a brand-new task cannot be part
    // of a cycle, but a blocker id that does not exist still has to be caught.
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
          phaseId: data.phaseId ? Number(data.phaseId) : null,
          companyId,
          columnId: firstColumn?.id ?? null,
          reporterId,
          position: last ? last.position + 1 : 0,
          startDate: data.startDate ? new Date(data.startDate) : null,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          estimatedHours: data.estimatedHours != null ? Number(data.estimatedHours) : null,
        },
      });

      const assignees = await this.syncAssignees(tx, created.id, data.assigneeIds ?? []);

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
    await this.notificationsService.notifyEmployees(data.assigneeIds ?? [], {
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
    opts: { includeReported?: boolean; includeDone?: boolean; scope?: TaskScope } = {},
  ): Promise<{ items: MyTaskDto[]; truncated: boolean; scope: TaskScope }> {
    const everyone = opts.scope === 'all' && (role === 'SUPERADMIN' || role === 'ADMIN');

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
        ...(everyone ? {} : { OR: mine }),
      },
      select: {
        id: true, key: true, title: true, status: true, priority: true,
        startDate: true, dueDate: true, estimatedHours: true,
        project: { select: { id: true, name: true, key: true, isSystem: true } },
        // §17: the task list filters by project code and by milestone, and
        // both are cheap joins the row already half-carries.
        milestone: { select: { id: true, name: true } },
        lead: { select: { id: true, title: true, leadCode: true, companyName: true, contactName: true, flow: true } },
        taskType: { select: { name: true } },
        phase: { select: { id: true, name: true } },
        assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
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
      orderBy: [{ dueDate: 'asc' }, { id: 'desc' }],
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
        source: general ? 'GENERAL' : 'PROJECT',
        id: i.id,
        refKey: i.key,
        title: i.title,
        status: this.normaliseIssueStatus(i.status),
        rawStatus: i.status,
        priority: i.priority,
        taskType: i.taskType?.name ?? null,
        // §8: both id and name -- the name renders, the id drives the filter.
        phaseId: i.phase?.id ?? null,
        phase: i.phase?.name ?? null,
        // Null on a general or deal task, which has no project to code.
        projectCode: general ? null : (i.project?.key ?? null),
        milestone: i.milestone ? { id: i.milestone.id, name: i.milestone.name } : null,
        startDate: i.startDate,
        dueDate: i.dueDate,
        estimatedHours: i.estimatedHours,
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
      isAdmin: role === 'SUPERADMIN' || role === 'ADMIN',
    });

    const all = [...items, ...preSales];
    all.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.getTime() - b.dueDate.getTime();
    });

    return {
      items: all,
      truncated: issues.length >= PER_SOURCE_CAP || preSales.length >= PER_SOURCE_CAP,
      // Echoed back so the UI reflects what it actually got rather than what it
      // asked for — a non-admin who sends scope=all is answered with 'mine'.
      scope: everyone ? 'all' : 'mine',
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
}
