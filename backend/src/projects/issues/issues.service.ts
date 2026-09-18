import { Injectable, NotFoundException, HttpException, HttpStatus, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectTicketsService } from '../tickets/project-tickets.service';
import axios from 'axios';
import * as path from 'path';
import * as crypto from 'crypto';
import FormData from 'form-data';
import { TasksGateway } from '../../events/tasks/tasks.gateway';
import { NotificationsService } from '../../notifications/notifications.service';
import { canCreateTask, canManageTask } from '../../tasks/task-permissions';
import { renameKeepingExtension } from '../document-naming';

/**
 * Whether a submitted value actually differs from what is stored.
 *
 * Every edit posts the whole form back, so equality has to mean "unchanged" or
 * an employee moving their own card would be refused for the dates they never
 * touched. Dates arrive as ISO strings against Date objects, and numeric ids
 * as strings, so both are normalised before comparing.
 */
/**
 * The stored name for an attachment: what the user typed, or the file's own
 * name when they typed nothing. An unusable name falls back rather than
 * failing the upload -- the file is already in ImageKit by this point, and
 * refusing the row over a name would strand it there.
 */
function resolveAttachmentName(originalName: string, requestedName?: string): string {
  if (!requestedName?.trim()) return originalName;
  try {
    return renameKeepingExtension(originalName, requestedName);
  } catch {
    return originalName;
  }
}

function sameValue(next: unknown, current: unknown): boolean {
  if (next == null && current == null) return true;
  if (next == null || current == null) return false;

  if (current instanceof Date) {
    const t = new Date(next as any).getTime();
    return !Number.isNaN(t) && t === current.getTime();
  }
  if (typeof current === 'number') return Number(next) === current;
  if (typeof current === 'boolean') return Boolean(next) === current;
  return String(next) === String(current);
}
import { assertWithinAllowedHours, remainingHours, HoursExceeded } from '../../tasks/task-hours';

@Injectable()
export class IssuesService {
  constructor(
    private prisma: PrismaService,
    private tasksGateway: TasksGateway,
    private notificationsService: NotificationsService,
    private projectTickets: ProjectTicketsService,
  ) {}

  async createIssue(companyId: number, reporterId: number, projectId: number, data: any, role?: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId, companyId } });
    if (!project) throw new NotFoundException('Project not found');

    // Admins, the project owner, and any department flagged as able to raise
    // tasks. Shared with TasksService so the rule has one definition — see
    // tasks/task-permissions.ts for why it is a flag and not a name match.
    if (!(await canCreateTask(this.prisma as any, companyId, reporterId, role, project))) {
      throw new ForbiddenException(
        'You do not have permission to create tasks in this project.',
      );
    }

    const count = await this.prisma.issue.count({ where: { projectId, companyId } });
    const key = `${project.key}-${count + 1}`;

    let columnId = data.columnId;
    if (!columnId) {
      const board = await this.prisma.board.findFirst({ 
        where: { projectId }, 
        include: { columns: { orderBy: { position: 'asc' } } } 
      });
      if (board && board.columns.length > 0) {
        columnId = board.columns[0].id;
      }
    }

    if (columnId) {
      const targetCol = await this.prisma.boardColumn.findUnique({ where: { id: Number(columnId) } });
      if (targetCol && this.isRestrictedColumn(targetCol)) {
        await this.assertCanCompleteOrArchive(
          companyId, reporterId, { projectId, assigneeId: data.assigneeId ? Number(data.assigneeId) : null }, role,
        );
      }
    }

    /**
     * A new task must belong to a phase (§8).
     *
     * Only when the company actually has phases to choose from. A company
     * that has retired all of them, or never had any, would otherwise lose
     * task creation entirely -- a rule about which phase work belongs to is
     * meaningless where there are no phases, and enforcing it there breaks
     * the board rather than organising it.
     *
     * New tasks only. Editing a task raised before phases existed does not
     * demand one: 1,400 of them have none, and refusing to save a title
     * change until somebody classifies the backlog is not a business rule,
     * it is a blockade.
     */
    if (!data.phaseId) {
      const phasesExist = await this.prisma.projectPhase.count({
        where: { companyId, isActive: true },
      });
      if (phasesExist > 0) {
        throw new BadRequestException('Choose the project phase this task belongs to.');
      }
    }

    // Breaking a task into sub-tasks is planning it, not doing it, so raising
    // a child under someone else's task is a management act.
    if (data.parentId) {
      const mayManage = await canManageTask(
        this.prisma as any, companyId, projectId, reporterId, role,
      );
      if (!mayManage) {
        throw new ForbiddenException(
          'Only the project manager can add a child task under an existing task.',
        );
      }
    }

    /**
     * A new task goes to the TOP of its column, not the bottom.
     *
     * The thing somebody just created is the thing they are looking for, and
     * on a column with forty cards the bottom is off screen. Done by taking
     * one BELOW the current minimum rather than renumbering every sibling:
     * position is only ever read as an ordering, so a negative is fine, and
     * shifting the whole column would be forty writes to place one card.
     */
    const firstIssue = await this.prisma.issue.findFirst({
      where: { columnId },
      orderBy: { position: 'asc' }
    });
    const position = firstIssue ? firstIssue.position - 1 : 0;

    const issue = await this.prisma.issue.create({
      data: {
        key,
        title: data.title,
        description: data.description,
        type: data.type || 'TASK',
        priority: data.priority || 'MEDIUM',
        projectId,
        companyId,
        columnId,
        reporterId,
        assigneeId: data.assigneeId,
        position,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        parentId: data.parentId ? Number(data.parentId) : null,
        // §15: optional at creation — a task often exists before anyone
        // decides which milestone it belongs to.
        milestoneId: await this.resolveMilestoneId(companyId, projectId, data.milestoneId),
        // §8: the delivery phase. Optional at creation for the same reason as
        // the milestone above, and because every task predating phases has
        // none -- requiring one here would refuse the board's quick-add.
        phaseId: await this.resolvePhaseId(companyId, data.phaseId),
        /// The hours the task is assigned (§3).
        ///
        /// Accepted here as well as on update: the board's create form has
        /// collected Estimated Hours all along and this method silently
        /// dropped it, so a task created with "4h" typed into it came out
        /// unestimated -- and an unestimated task is unbounded, meaning the
        /// hours ceiling never applied to anything created from the board.
        estimatedHours: data.estimatedHours != null && data.estimatedHours !== ''
          ? Number(data.estimatedHours)
          : null,
      }
    });

    const activity = await this.prisma.issueActivity.create({
      data: { action: 'CREATED', issueId: issue.id, actorId: reporterId },
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      }
    });

    this.tasksGateway.emitIssueUpdated(issue.id, projectId, issue);
    this.tasksGateway.emitActivityAdded(issue.id, activity);

    return issue;
  }

  async getIssues(companyId: number, projectId: number) {
    const issues = await this.prisma.issue.findMany({
      where: { projectId, companyId },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        reporter: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        labels: { include: { label: true } },
        members: { include: { employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } }, designation: { select: { name: true } } } } } },
        attachments: { include: { uploader: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
        parent: { select: { id: true, key: true, title: true, type: true, status: true } },
        children: { select: { id: true, key: true, title: true, type: true, status: true, priority: true, assignee: { select: { avatarUrl: true } } }, orderBy: { position: 'asc' } },
        timeLogs: { select: { id: true, durationMin: true, startedAt: true, endedAt: true } },
        // §15: so the card and the task modal can show and change it.
        milestone: { select: { id: true, name: true, status: true } },
        // §8: so the card, the modal and the phase filter can all read it.
        phase: { select: { id: true, name: true, isActive: true } },
        // §6: where the task came from. A task converted from a ticket should
        // be identifiable without opening it -- the relation has existed since
        // tickets shipped, it was simply never selected.
        projectTicket: {
          select: {
            id: true, ticketNumber: true, title: true, status: true,
            raisedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        _count: { select: { comments: true } }
      },
      orderBy: { position: 'asc' }
    });

    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      select: { id: true, managerId: true }
    });
    const managerById = new Map<number, number | null>(employees.map(e => [e.id, e.managerId]));

    const chainFor = (empId: number | null): number[] => {
      if (!empId) return [];
      const chain: number[] = [];
      const visited = new Set<number>();
      let current: number | null = empId;
      while (current != null && !visited.has(current)) {
        visited.add(current);
        current = managerById.get(current) ?? null;
        if (current != null) chain.push(current);
      }
      return chain;
    };

    return issues.map(issue => ({
      ...issue,
      assigneeApproverIds: chainFor(issue.assigneeId)
    }));
  }

  private async getAssigneeUpperHierarchy(companyId: number, assigneeId: number): Promise<number[]> {
    const chain: number[] = [];
    const visited = new Set<number>();
    let current: number | null = assigneeId;
    while (current != null && !visited.has(current)) {
      visited.add(current);
      const emp = await this.prisma.employee.findUnique({
        where: { id: current },
        select: { id: true, managerId: true },
      });
      if (!emp || emp.managerId == null) break;
      chain.push(emp.managerId);
      current = emp.managerId;
    }
    return chain;
  }

  private async getDescendantAndAncestorUserIds(companyId: number, employeeId: number): Promise<number[]> {
    const userIds: number[] = [];
    const visited = new Set<number>();

    // Walk UP the manager chain (ancestors)
    let current: number | null = employeeId;
    while (current != null && !visited.has(current)) {
      visited.add(current);
      const emp = await this.prisma.employee.findUnique({
        where: { id: current },
        select: { managerId: true, userId: true },
      });
      if (!emp) break;
      if (emp.userId) userIds.push(emp.userId);
      current = emp.managerId;
    }

    return userIds;
  }

  private isRestrictedColumn(col: any): boolean {
    if (col.type === 'DONE') return true;
    const n = col.name.toLowerCase();
    return n.includes('done') || n.includes('complete') || n.includes('archive');
  }

  private async assertCanCompleteOrArchive(
    companyId: number,
    actorEmployeeId: number,
    issue: any,
    role?: string,
  ) {
    // Administrators, as everywhere else in this service. Without this an admin
    // could not close a task unless they happened to own the project, be a PM
    // on it, or sit above the assignee — and for a task in the General project,
    // which has no owner and no project managers by construction, the only gate
    // left was the assignee's manager chain. An administrator with nobody
    // reporting to them could not close a general task at all.
    if (role === 'SUPERADMIN' || role === 'ADMIN') return;

    const project = issue.projectId
      ? await this.prisma.project.findUnique({ where: { id: issue.projectId }, select: { leadId: true, isSystem: true, name: true } })
      : null;

    // The project Owner can always move a task to Done/Archive.
    if (project?.leadId === actorEmployeeId) return;

    // A task assigned to a Project Manager can only be advanced by the Owner — blocks
    // other PMs and the assignee's manager-hierarchy too.
    if (issue.assigneeId && issue.projectId) {
      const assigneeIsPM = await this.prisma.projectMember.findFirst({
        where: { projectId: issue.projectId, employeeId: issue.assigneeId, role: 'PROJECT_MANAGER' }
      });
      if (assigneeIsPM) {
        throw new ForbiddenException(
          'This task is assigned to a Project Manager, so only the project owner (or an administrator) can move it to Review, Done or Archived.',
        );
      }
    }

    if (issue.projectId) {
      const pm = await this.prisma.projectMember.findFirst({
        where: { projectId: issue.projectId, employeeId: actorEmployeeId, role: 'PROJECT_MANAGER' }
      });
      if (pm) return;
    }

    if (!issue.assigneeId) {
      const subordinateCount = await this.prisma.employee.count({
        where: { companyId, managerId: actorEmployeeId }
      });
      if (subordinateCount === 0) {
        throw new ForbiddenException(
          'This task is unassigned, and only someone who manages people — or the project owner, a project manager, or an administrator — can move it to Done or archive it. Assign it to someone first.',
        );
      }
      return;
    }

    if (actorEmployeeId === issue.assigneeId) {
      throw new ForbiddenException(
        'You cannot sign off your own task. Ask your manager, the project owner or an administrator to move it to Done.',
      );
    }

    const hierarchy = await this.getAssigneeUpperHierarchy(companyId, issue.assigneeId);
    if (!hierarchy.includes(actorEmployeeId)) {
      // Name the person. "The assignee's manager" sends someone hunting through
      // the org chart for who that is; the task says who it belongs to.
      const assignee = await this.prisma.employee.findUnique({
        where: { id: issue.assigneeId },
        select: { firstName: true, lastName: true },
      });
      const who = `${assignee?.firstName ?? ''} ${assignee?.lastName ?? ''}`.trim();
      throw new ForbiddenException(
        `This task belongs to ${who || 'someone else'}. Only their manager, the project owner${project?.isSystem ? '' : ' or a project manager on this board'}, or an administrator can move it to Done or archive it.`,
      );
    }
  }

  async updateIssue(companyId: number, employeeId: number, projectId: number, issueId: number, data: any, role?: string) {
    const oldIssue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!oldIssue) throw new NotFoundException('Issue not found');


    /**
     * Fields only management may change.
     *
     * Deliberately a list of what is CLOSED rather than what is open: a field
     * added later should need a decision to become editable by everyone, not
     * become editable by everyone through being forgotten.
     *
     * status, columnId and position stay open -- moving your own card across
     * the board is the work, not a decision about it.
     */
    const MANAGED_FIELDS: { key: string; label: string }[] = [
      { key: 'title', label: 'the title' },
      { key: 'description', label: 'the description' },
      { key: 'priority', label: 'the priority' },
      { key: 'dueDate', label: 'the due date' },
      { key: 'startDate', label: 'the start date' },
      { key: 'dueReminder', label: 'the reminder' },
      { key: 'recurring', label: 'the recurrence' },
      { key: 'milestoneId', label: 'the milestone' },
      { key: 'phaseId', label: 'the phase' },
      { key: 'assigneeId', label: 'who the task is assigned to' },
      { key: 'parentId', label: 'the parent task' },
      { key: 'isArchived', label: 'whether the task is archived' },
    ];

    const attempted = MANAGED_FIELDS.filter(
      (f) => data[f.key] !== undefined && !sameValue(data[f.key], (oldIssue as any)[f.key]),
    );

    if (attempted.length) {
      if (!(await this.mayManageTask(companyId, projectId, employeeId, role))) {
        throw new ForbiddenException(
          `Only the project manager can change ${attempted[0].label} on a task.`,
        );
      }
    }

    /**
     * Changing the assigned hours is a management act, not an edit (§3).
     *
     * The ceiling only means anything if the person it constrains cannot lift
     * it. An employee who can retype ESTIMATED from 2 to 40 never needs to
     * request additional hours at all, and the whole approval flow becomes
     * decoration -- so this is refused for anyone but the people who assign
     * the work and rule on those requests.
     *
     * Checked here rather than only in the UI because hiding the input stops
     * the form, not the endpoint.
     */
    if (data.estimatedHours !== undefined
        && Number(data.estimatedHours ?? 0) !== Number(oldIssue.estimatedHours ?? 0)) {
      if (!(await this.mayManageTask(companyId, projectId, employeeId, role))) {
        throw new ForbiddenException(
          'Only the project manager can change the hours assigned to a task. ' +
          'Raise an additional-hours request instead.',
        );
      }
    }

    const prevStatus = oldIssue.status;

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    // §15: the milestone this task delivers. Validated against the project so
    // a task cannot be attached to another project's milestone.
    if (data.milestoneId !== undefined) {
      updateData.milestoneId = await this.resolveMilestoneId(companyId, projectId, data.milestoneId);
    }
    // §8: the delivery phase, validated against the company's own list.
    if (data.phaseId !== undefined) {
      updateData.phaseId = await this.resolvePhaseId(companyId, data.phaseId);
    }
    let isRestrictedTarget = data.status === 'DONE';

    if (data.columnId !== undefined) {
      updateData.columnId = Number(data.columnId);
      const targetCol = await this.prisma.boardColumn.findUnique({ where: { id: updateData.columnId } });
      if (targetCol) {
        if (this.isRestrictedColumn(targetCol)) {
          isRestrictedTarget = true;
        }
        // Enforce adjacent-column-only moves on the backend
        if (oldIssue.columnId && oldIssue.columnId !== updateData.columnId) {
          const columns = await this.prisma.boardColumn.findMany({
            where: { board: { projectId }, isArchived: false },
            orderBy: { position: 'asc' }
          });
          const fromIdx = columns.findIndex(c => c.id === oldIssue.columnId);
          const toIdx = columns.findIndex(c => c.id === updateData.columnId);
          if (fromIdx !== -1 && toIdx !== -1 && Math.abs(toIdx - fromIdx) !== 1) {
            const next = columns[fromIdx + (toIdx > fromIdx ? 1 : -1)];
            throw new ForbiddenException(
              `A task moves one column at a time${next ? `, so "${columns[fromIdx].name}" goes to "${next.name}" next` : ''}.`,
            );
          }
        }
        if (data.status === undefined) {
          const colName = targetCol.name.toLowerCase();
          if (colName.includes('done') || colName.includes('complete')) updateData.status = 'DONE';
          else if (colName.includes('progress') || colName.includes('doing')) updateData.status = 'IN_PROGRESS';
          else if (colName.includes('review')) updateData.status = 'IN_REVIEW';
          else if (colName.includes('to do') || colName.includes('todo')) updateData.status = 'TODO';
        }
      }
    }

    if (isRestrictedTarget) {
      await this.assertCanCompleteOrArchive(companyId, employeeId, oldIssue, role);
      // The one place a dependency is enforced rather than advised.
      //
      // Everywhere else an open blocker is a chip and a note, because a stale
      // blocker nobody closed must not be able to stop real work. Moving into
      // Review or Done is different: it is a claim that the task is finished,
      // and it demonstrably is not while something it waits on is still open.
      const openBlockers = await this.prisma.issueDependency.findMany({
        where: {
          issueId,
          companyId,
          type: 'BLOCKS',
          dependsOnIssue: { status: { notIn: ['DONE', 'CANCELLED'] } },
        },
        select: { dependsOnIssue: { select: { key: true, title: true } } },
      });
      if (openBlockers.length) {
        const list = openBlockers.map((b) => b.dependsOnIssue.key).join(', ');
        throw new BadRequestException(
          openBlockers.length === 1
            ? `This task is waiting on ${list}, which is not finished yet.`
            : `This task is waiting on ${list}, which are not finished yet.`,
        );
      }
    }
    if (data.assigneeId !== undefined) updateData.assigneeId = data.assigneeId ? Number(data.assigneeId) : null;
    if (data.parentId !== undefined) updateData.parentId = data.parentId ? Number(data.parentId) : null;
    if (data.position !== undefined) updateData.position = Number(data.position);
    if (data.startDate !== undefined) updateData.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (data.recurring !== undefined) updateData.recurring = data.recurring;
    if (data.dueReminder !== undefined) updateData.dueReminder = data.dueReminder;
    if (data.estimatedHours !== undefined) updateData.estimatedHours = data.estimatedHours ? Number(data.estimatedHours) : null;

    let issue = await this.prisma.issue.update({
      where: { id: issueId },
      data: updateData
    });

    // §30: a task that came from a ticket updates that ticket when it is
    // finished — and pulls it back if the task is reopened. Fire-and-forget by
    // design: bookkeeping on a ticket must never fail somebody's attempt to
    // close a task, and most tasks were never tickets.
    if (updateData.status && updateData.status !== prevStatus) {
      await this.projectTickets.onIssueStatusChanged(issueId, updateData.status);
    }

    // Auto time tracking: start timer when card moves to IN_PROGRESS,
    // stop timer when card moves to IN_REVIEW.
    const targetStatus = updateData.status;
    let timerSideEffectApplied = false;
    if (targetStatus === 'IN_PROGRESS' && prevStatus !== 'IN_PROGRESS') {
      if (!oldIssue.workStartedAt || oldIssue.workCompletedAt) {
        await this.startTimeTracking(companyId, employeeId, projectId, issueId);
        timerSideEffectApplied = true;
      }
    } else if (targetStatus === 'IN_REVIEW' && prevStatus !== 'IN_REVIEW') {
      if (oldIssue.workStartedAt && !oldIssue.workCompletedAt) {
        await this.stopTimeTracking(companyId, employeeId, projectId, issueId);
        timerSideEffectApplied = true;
      }
    }

    // startTimeTracking/stopTimeTracking update workStartedAt/workCompletedAt
    // on their own separate write — reflect that in the response we return below,
    // otherwise callers get a stale snapshot from before the side effect ran.
    if (timerSideEffectApplied) {
      issue = await this.prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
    }

    // Simple activity logging for column change
    if (data.columnId && Number(data.columnId) !== oldIssue.columnId) {
      const activity = await this.prisma.issueActivity.create({
        data: {
          action: 'STATUS_CHANGED',
          field: 'columnId',
          oldValue: oldIssue.columnId?.toString(),
          newValue: data.columnId.toString(),
          issueId,
          actorId: employeeId
        },
        include: {
          actor: {
            select: { id: true, firstName: true, lastName: true, avatarUrl: true }
          }
        }
      });
      this.tasksGateway.emitActivityAdded(issueId, activity);
    }

    // Notify project lead + all upper hierarchy when task moves to DONE
    const newStatus = updateData.status;
    if (newStatus === 'DONE' && prevStatus !== 'DONE') {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { leadId: true, name: true }
      });

      const actor = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { firstName: true, lastName: true }
      });
      const actorName = actor ? `${actor.firstName} ${actor.lastName}` : 'Someone';

      const assignee = oldIssue.assigneeId
        ? await this.prisma.employee.findUnique({
            where: { id: oldIssue.assigneeId },
            select: { firstName: true, lastName: true }
          })
        : null;
      const assigneeName = assignee ? `${assignee.firstName} ${assignee.lastName}` : 'Unassigned';

      const notifyUserIds = new Set<number>();

      // 1. Notify project lead (if different from actor)
      if (project?.leadId && project.leadId !== employeeId) {
        const lead = await this.prisma.employee.findUnique({
          where: { id: project.leadId },
          select: { userId: true }
        });
        if (lead) notifyUserIds.add(lead.userId);
      }

      // 2. Walk up the actor's manager chain and notify every upper hierarchy person
      const hierarchy = await this.getDescendantAndAncestorUserIds(companyId, employeeId);
      for (const uid of hierarchy) {
        if (uid !== employeeId) notifyUserIds.add(uid);
      }

      const message = `${actorName} marked "${oldIssue.title}" (${oldIssue.key}) assigned to ${assigneeName} as Done in ${project?.name || 'the project'}. Kindly review.`;

      for (const uid of notifyUserIds) {
        await this.notificationsService.createNotification(
          uid,
          'Task Completed – Review Requested',
          message,
          'SUCCESS',
          `/projects/${projectId}`,
          companyId
        );
      }
    }

    this.tasksGateway.emitIssueUpdated(issueId, projectId, issue);

    return issue;
  }

  async toggleArchive(companyId: number, employeeId: number, projectId: number, issueId: number, role?: string) {
    const oldIssue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!oldIssue) throw new NotFoundException('Issue not found');

    if (!oldIssue.isArchived) {
      await this.assertCanCompleteOrArchive(companyId, employeeId, oldIssue, role);
    }

    const issue = await this.prisma.issue.update({
      where: { id: issueId },
      data: { isArchived: !oldIssue.isArchived }
    });

    await this.prisma.issueActivity.create({
      data: {
        action: issue.isArchived ? 'ARCHIVED' : 'UNARCHIVED',
        issueId,
        actorId: employeeId
      }
    });

    return issue;
  }

  /**
   * Time-tracking endpoints receive the JWT `sub` (a User id). Every read path
   * queries IssueTimeLog by Employee id. Those currently coincide only because
   * users and employees were created in lockstep — resolve properly so the two
   * cannot drift apart.
   */
  private async resolveEmployeeId(companyId: number, userId: number): Promise<number> {
    const employee = await this.prisma.employee.findFirst({
      where: { userId, companyId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('No employee profile for this user');
    return employee.id;
  }

  /**
   * Validate a milestone belongs to this project before attaching a task.
   *
   * Milestone ids are unique company-wide, so without this check a task could
   * be pointed at another project's milestone — which would then count it in
   * that milestone's progress and, once invoicing lands, against its value.
   */
  /**
   * Refuse a management act to somebody who only works on the task.
   *
   * `what` completes the sentence, so the refusal names the thing that was
   * refused rather than saying no in the abstract.
   */
  private async assertMayManageTask(
    companyId: number,
    projectId: number,
    actorEmployeeId: number | undefined,
    role: string | undefined,
    what: string,
  ) {
    if (actorEmployeeId === undefined) return;
    if (await this.mayManageTask(companyId, projectId, actorEmployeeId, role)) return;
    throw new ForbiddenException(`Only the project manager can change ${what} on a task.`);
  }

  /**
   * Who may manage a task rather than merely work on it: an administrator, the
   * project lead, or a member carrying the PROJECT_MANAGER role.
   *
   * This is the line between doing the work and deciding what the work is.
   * An employee moves their own card, logs time against it, comments on it and
   * attaches evidence to it. Changing what it is worth, when it is due, who is
   * on it, what it is called or whether it exists at all is somebody else's
   * call -- otherwise every constraint placed on the task can be lifted by the
   * person it constrains.
   *
   * Deliberately the same set that approves additional-hours requests. If the
   * two differed, somebody could grant themselves hours through whichever door
   * was left open.
   */
  private mayManageTask(
    companyId: number,
    projectId: number,
    employeeId: number,
    role?: string,
  ): Promise<boolean> {
    return canManageTask(this.prisma as any, companyId, projectId, employeeId, role);
  }


  /**
   * The phase id to store, from whatever the form sent (§8).
   *
   * Checked against the company's own phases so a task cannot be pinned to
   * another company's phase by id. An inactive phase is still accepted on an
   * existing task: retiring a phase hides it from new work, it does not make
   * the tasks already in it unsaveable.
   */
  private async resolvePhaseId(companyId: number, phaseId: any): Promise<number | null> {
    if (phaseId === null || phaseId === '' || phaseId === undefined) return null;
    const id = Number(phaseId);
    if (!Number.isFinite(id)) return null;

    const phase = await this.prisma.projectPhase.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!phase) throw new BadRequestException('That phase does not belong to this company');
    return phase.id;
  }

  private async resolveMilestoneId(
    companyId: number,
    projectId: number,
    milestoneId: any,
  ): Promise<number | null> {
    if (milestoneId === null || milestoneId === '' || milestoneId === undefined) return null;

    const id = Number(milestoneId);
    const milestone = await this.prisma.projectMilestone.findFirst({
      where: { id, projectId, companyId },
      select: { id: true },
    });
    if (!milestone) throw new BadRequestException('That milestone does not belong to this project');
    return milestone.id;
  }

  /**
   * Move a task out of a To Do column the moment work is logged against it.
   *
   * A task with hours on it is demonstrably not "to do". Only ever promotes
   * out of TODO: a retrospective log against something already in review or
   * done must not drag it backwards, which is why this is not a blanket
   * "set IN_PROGRESS".
   */
  private async promoteFromTodoOnWork(projectId: number, issue: { id: number; columnId: number | null; status: string }) {
    const currentCol = issue.columnId
      ? await this.prisma.boardColumn.findUnique({ where: { id: issue.columnId } })
      : null;

    const isTodo = currentCol ? currentCol.type === 'TODO' : issue.status === 'TODO';
    if (!isTodo) return;

    const inProgress = await this.prisma.boardColumn.findFirst({
      where: { board: { projectId }, type: 'IN_PROGRESS', isArchived: false },
      orderBy: { position: 'asc' },
    });

    await this.prisma.issue.update({
      where: { id: issue.id },
      data: {
        status: 'IN_PROGRESS',
        ...(inProgress ? { columnId: inProgress.id } : {}),
      },
    });
  }

  /**
   * §9: refuse hand-entered time on a project that requires the timer.
   *
   * The switch has existed since the Delivery module's first phase and was
   * written by the project form, read by nothing — so a project set to
   * "timer only" still accepted typed hours. Checked here rather than in the
   * controller because both the Log Work button and the weekly grid write
   * manual rows, and a rule enforced in one path is not a rule.
   *
   * The timer is never blocked: it records observed work, which is the thing
   * the setting exists to prefer.
   */
  /**
   * The state of a task's hours budget: what it was assigned, what approved
   * requests have added, and everything logged against it so far (§3).
   */
  private async loadTaskHoursState(issueId: number) {
    const [issue, agg] = await Promise.all([
      this.prisma.issue.findUnique({
        where: { id: issueId },
        select: { estimatedHours: true, additionalHours: true },
      }),
      this.prisma.issueTimeLog.aggregate({
        where: { issueId },
        _sum: { durationMin: true },
      }),
    ]);
    if (!issue) throw new NotFoundException('Issue not found');
    return {
      estimatedHours: issue.estimatedHours,
      additionalHours: issue.additionalHours ?? 0,
      loggedMinutes: agg._sum.durationMin ?? 0,
    };
  }

  /**
   * Refuse a write that would take a task past its allowed hours (§3).
   *
   * Enforced here, in the service, rather than only in the UI: the rule has to
   * hold for anything that reaches the API, and the form is the one caller
   * that can be bypassed.
   */
  private async assertTaskHoursAvailable(
    issueId: number,
    additionalMinutes: number,
    excludeMinutes = 0,
  ) {
    const state = await this.loadTaskHoursState(issueId);
    try {
      assertWithinAllowedHours(state, additionalMinutes, excludeMinutes);
    } catch (e) {
      if (e instanceof HoursExceeded) throw new BadRequestException(e.message);
      throw e;
    }
  }

  private async assertManualLoggingAllowed(projectId: number) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { allowManualTimeLogging: true, name: true },
    });
    if (project && !project.allowManualTimeLogging) {
      throw new BadRequestException(
        `${project.name} does not allow manual time entry. Use the timer to record work on this project.`,
      );
    }
  }

  async startTimeTracking(companyId: number, userId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');
    const employeeId = await this.resolveEmployeeId(companyId, userId);

    // The timer is gated on START, never on stop.
    //
    // Stopping is the moment work that has already happened gets written down.
    // Refusing it would discard real time and leave the timer running with no
    // way to close it, so the check belongs at the point where there is still
    // a decision to make: whether to begin at all.
    const hoursState = await this.loadTaskHoursState(issueId);
    const left = remainingHours(hoursState);
    if (left != null && left <= 0) {
      const allowed = (hoursState.estimatedHours ?? 0) + hoursState.additionalHours;
      throw new BadRequestException(
        `All ${allowed}h assigned to this task have been logged. ` +
        `Request additional hours before starting the timer again.`,
      );
    }

    const now = new Date();
    await this.prisma.issue.update({
      where: { id: issueId },
      data: { workStartedAt: now, workCompletedAt: null }
    });

    await this.prisma.issueTimeLog.create({
      data: { issueId, employeeId, startedAt: now }
    });

    await this.prisma.issueActivity.create({
      data: { action: 'WORK_STARTED', issueId, actorId: employeeId }
    });

    await this.promoteFromTodoOnWork(projectId, issue);

    return { success: true, startedAt: now };
  }

  async stopTimeTracking(companyId: number, userId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');
    const employeeId = await this.resolveEmployeeId(companyId, userId);

    const now = new Date();
    
    // Close the latest open time log for the issue (timer is issue-level, not per-user)
    const openLog = await this.prisma.issueTimeLog.findFirst({
      where: { issueId, endedAt: null },
      orderBy: { startedAt: 'desc' }
    });

    if (openLog) {
      const durationMin = Math.round((now.getTime() - openLog.startedAt.getTime()) / 60000);
      await this.prisma.issueTimeLog.update({
        where: { id: openLog.id },
        data: { endedAt: now, durationMin }
      });
    }

    await this.prisma.issue.update({
      where: { id: issueId },
      data: { workCompletedAt: now }
    });

    await this.prisma.issueActivity.create({
      data: { action: 'WORK_STOPPED', issueId, actorId: employeeId }
    });

    return { success: true, completedAt: now };
  }

  async addManualTimeLog(companyId: number, userId: number, projectId: number, issueId: number, data: { durationMin: number }) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');
    if (!data?.durationMin || data.durationMin <= 0) {
      throw new BadRequestException('durationMin must be a positive number of minutes');
    }
    await this.assertManualLoggingAllowed(projectId);
    await this.assertTaskHoursAvailable(issueId, data.durationMin);
    const employeeId = await this.resolveEmployeeId(companyId, userId);

    const now = new Date();
    const startedAt = new Date(now.getTime() - data.durationMin * 60000);

    const log = await this.prisma.issueTimeLog.create({
      data: {
        issueId,
        employeeId,
        startedAt,
        endedAt: now,
        durationMin: data.durationMin,
        // Log Work is manual by definition. It defaulted to TIMER, which made
        // the weekly timesheet treat hand-entered time as timer evidence and
        // refuse to correct it downwards ("you have 0.50h tracked by timer")
        // for time no timer ever ran.
        source: 'MANUAL',
      }
    });

    await this.prisma.issueActivity.create({
      data: { action: 'TIME_LOGGED', issueId, actorId: employeeId }
    });

    await this.promoteFromTodoOnWork(projectId, issue);

    return { success: true, log };
  }

  /**
   * Sets the caller's TOTAL logged minutes for one issue on one calendar day —
   * the contract the weekly timesheet grid needs.
   *
   * Timer rows are evidence of tracked work and are never rewritten; the manual
   * row absorbs the difference. A target below the tracked total is refused
   * rather than silently discarding timer records.
   */
  async setDayTimeTotal(
    companyId: number,
    userId: number,
    projectId: number,
    issueId: number,
    data: { date: string; durationMin: number },
  ) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    const target = Math.round(Number(data?.durationMin));
    if (!Number.isFinite(target) || target < 0) {
      throw new BadRequestException('durationMin must be zero or a positive number of minutes');
    }

    const dayStart = new Date(`${data?.date}T00:00:00`);
    if (isNaN(dayStart.getTime())) {
      throw new BadRequestException('A valid date (YYYY-MM-DD) is required');
    }
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    await this.assertManualLoggingAllowed(projectId);
    const employeeId = await this.resolveEmployeeId(companyId, userId);

    const sameDay = { employeeId, issueId, startedAt: { gte: dayStart, lte: dayEnd } };

    const [timerLogs, manualLog] = await Promise.all([
      this.prisma.issueTimeLog.findMany({ where: { ...sameDay, source: 'TIMER' } }),
      this.prisma.issueTimeLog.findFirst({ where: { ...sameDay, source: 'MANUAL' } }),
    ]);

    const trackedMin = timerLogs.reduce((sum, l) => sum + (l.durationMin ?? 0), 0);
    if (target < trackedMin) {
      throw new BadRequestException(
        `You have ${(trackedMin / 60).toFixed(2)}h tracked by timer on this day; the total cannot be lower.`,
      );
    }

    const manualMin = target - trackedMin;

    // Checked as a delta: this row is upserted, so raising a 2h entry to 3h
    // adds one hour, not three. Passing the new total as a fresh log would
    // refuse edits that actually fit.
    if (manualMin > 0) {
      await this.assertTaskHoursAvailable(issueId, manualMin, manualLog?.durationMin ?? 0);
    }

    if (manualMin <= 0) {
      if (manualLog) await this.prisma.issueTimeLog.delete({ where: { id: manualLog.id } });
    } else if (manualLog) {
      await this.prisma.issueTimeLog.update({
        where: { id: manualLog.id },
        // Anchor the row inside the target day so the grid reads it back there.
        data: { durationMin: manualMin, startedAt: dayStart, endedAt: new Date(dayStart.getTime() + manualMin * 60000) },
      });
    } else {
      await this.prisma.issueTimeLog.create({
        data: {
          issueId,
          employeeId,
          source: 'MANUAL',
          startedAt: dayStart,
          endedAt: new Date(dayStart.getTime() + manualMin * 60000),
          durationMin: manualMin,
        },
      });
    }

    await this.prisma.issueActivity.create({
      data: { action: 'TIME_LOGGED', issueId, actorId: employeeId },
    });

    return { success: true, date: data.date, totalMin: target, trackedMin, manualMin: Math.max(manualMin, 0) };
  }

  async getComments(companyId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    return this.prisma.issueComment.findMany({
      where: { issueId },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  async getActivities(companyId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    return this.prisma.issueActivity.findMany({
      where: { issueId },
      include: {
        actor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  async addComment(companyId: number, userId: number, projectId: number, issueId: number, body: string) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    const authorId = employee ? employee.id : userId;

    const comment = await this.prisma.issueComment.create({
      data: {
        body,
        issueId,
        authorId
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true
          }
        }
      }
    });

    const activity = await this.prisma.issueActivity.create({
      data: {
        action: 'COMMENT_ADDED',
        issueId,
        actorId: authorId
      },
      include: {
        actor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true
          }
        }
      }
    });

    this.tasksGateway.emitCommentAdded(issueId, comment);
    this.tasksGateway.emitActivityAdded(issueId, activity);

    // Notify assignee or reporter
    const notifyUserId = issue.assigneeId && issue.assigneeId !== authorId ? issue.assigneeId : 
                         issue.reporterId && issue.reporterId !== authorId ? issue.reporterId : null;
    
    if (notifyUserId) {
      const u = await this.prisma.employee.findUnique({ where: { id: notifyUserId }, select: { userId: true } });
      if (u) {
        await this.notificationsService.createNotification(
          u.userId,
          `New Comment on ${issue.key}`,
          `${comment.author?.firstName || 'Someone'} commented: ${body.substring(0, 50)}...`,
          'INFO',
          `/projects/${projectId}?issue=${issue.key}`,
          companyId
        );
      }
    }

    return comment;
  }

  async deleteComment(companyId: number, projectId: number, issueId: number, commentId: number) {
    const comment = await this.prisma.issueComment.findUnique({ where: { id: commentId, issueId } });
    if (!comment) throw new NotFoundException('Comment not found');

    return this.prisma.issueComment.delete({
      where: { id: commentId }
    });
  }

  async getChecklists(companyId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    return this.prisma.checklist.findMany({
      where: { issueId },
      include: {
        items: {
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  async createChecklist(companyId: number, projectId: number, issueId: number, title: string, actorEmployeeId?: number, role?: string) {
    await this.assertMayManageTask(companyId, projectId, actorEmployeeId, role, 'the checklist');
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    return this.prisma.checklist.create({
      data: {
        title: title || 'Checklist',
        issueId
      },
      include: {
        items: true
      }
    });
  }

  async updateChecklist(companyId: number, projectId: number, issueId: number, checklistId: number, title: string, actorEmployeeId?: number, role?: string) {
    await this.assertMayManageTask(companyId, projectId, actorEmployeeId, role, 'the checklist');
    const checklist = await this.prisma.checklist.findUnique({ where: { id: checklistId, issueId } });
    if (!checklist) throw new NotFoundException('Checklist not found');

    return this.prisma.checklist.update({
      where: { id: checklistId },
      data: { title: title || 'Checklist' }
    });
  }

  async deleteChecklist(companyId: number, projectId: number, issueId: number, checklistId: number, actorEmployeeId?: number, role?: string) {
    await this.assertMayManageTask(companyId, projectId, actorEmployeeId, role, 'the checklist');
    const checklist = await this.prisma.checklist.findUnique({ where: { id: checklistId, issueId } });
    if (!checklist) throw new NotFoundException('Checklist not found');

    return this.prisma.checklist.delete({
      where: { id: checklistId }
    });
  }

  async addChecklistItem(companyId: number, projectId: number, issueId: number, checklistId: number, title: string, actorEmployeeId?: number, role?: string) {
    await this.assertMayManageTask(companyId, projectId, actorEmployeeId, role, 'the checklist');
    const checklist = await this.prisma.checklist.findUnique({ where: { id: checklistId, issueId } });
    if (!checklist) throw new NotFoundException('Checklist not found');

    return this.prisma.checklistItem.create({
      data: {
        title,
        checklistId
      }
    });
  }

  async updateChecklistItem(companyId: number, projectId: number, issueId: number, checklistId: number, itemId: number, data: any, actorEmployeeId?: number, role?: string) {
    const item = await this.prisma.checklistItem.findFirst({ where: { id: itemId, checklistId } });
    if (!item) throw new NotFoundException('Checklist item not found');

    const updateData: any = {};
    // Ticking an item off is doing the work, so anyone on the task may do it.
    // Renaming one is editing the checklist, which is not.
    if (data.isCompleted !== undefined) updateData.isCompleted = Boolean(data.isCompleted);
    if (data.title !== undefined && data.title !== item.title) {
      await this.assertMayManageTask(companyId, projectId, actorEmployeeId, role, 'the checklist');
      updateData.title = data.title;
    }

    return this.prisma.checklistItem.update({
      where: { id: itemId },
      data: updateData
    });
  }

  async deleteChecklistItem(companyId: number, projectId: number, issueId: number, checklistId: number, itemId: number, actorEmployeeId?: number, role?: string) {
    await this.assertMayManageTask(companyId, projectId, actorEmployeeId, role, 'the checklist');
    const item = await this.prisma.checklistItem.findFirst({ where: { id: itemId, checklistId } });
    if (!item) throw new NotFoundException('Checklist item not found');

    return this.prisma.checklistItem.delete({
      where: { id: itemId }
    });
  }

  async generateChecklist(companyId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    const description = issue.description || issue.title;
    
    // First create an empty checklist
    const checklist = await this.prisma.checklist.create({
      data: { title: 'Checklist', issueId }
    });

    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'openai/gpt-oss-20b',
          messages: [
            {
              role: 'system',
              content: 'You are a project management assistant. Break down the given task into a checklist. Return ONLY a valid JSON object with an "items" array containing strings. Example: {"items": ["task 1", "task 2"]}'
            },
            {
              role: 'user',
              content: `Generate a checklist for the following task:\n\nTitle: ${issue.title}\nDescription: ${description}`
            }
          ],
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0]?.message?.content;
      if (!content) throw new Error('No content from Groq');

      const parsed = JSON.parse(content);
      const items = Array.isArray(parsed.items) ? parsed.items : [];

      if (items.length === 0) {
        items.push('Review requirements', 'Execute task', 'Verify completion');
      }

      // Save to database inside the newly created checklist
      await Promise.all(
        items.slice(0, 10).map((title: string) => 
          this.prisma.checklistItem.create({
            data: { title: String(title).substring(0, 255), checklistId: checklist.id }
          })
        )
      );

      return this.prisma.checklist.findUnique({
        where: { id: checklist.id },
        include: { items: { orderBy: { createdAt: 'asc' } } }
      });
    } catch (error: any) {
      console.error('Groq generation error:', error?.response?.data || error.message);
      
      // Fallback if API fails
      await Promise.all(
        ['Review task details', 'Draft implementation plan', 'Execute implementation', 'Test changes'].map(title => 
          this.prisma.checklistItem.create({
            data: { title, checklistId: checklist.id }
          })
        )
      );
      
      return this.prisma.checklist.findUnique({
        where: { id: checklist.id },
        include: { items: { orderBy: { createdAt: 'asc' } } }
      });
    }
  }

  async getCompanyMembers(companyId: number) {
    return this.prisma.employee.findMany({
      where: { companyId },
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        user: { select: { email: true } },
        designation: { select: { name: true } }
      },
      orderBy: { firstName: 'asc' }
    });
  }

  async toggleIssueMember(companyId: number, projectId: number, issueId: number, employeeId: number, actorEmployeeId?: number, actorRole?: string) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    if (actorEmployeeId !== undefined && !(actorRole === 'SUPERADMIN' || actorRole === 'ADMIN')) {
      const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId }, select: { leadId: true } });
      // Whoever raised the task can staff it. Without this a Sales user could
      // create a task and then be unable to assign anyone to it: the General
      // project has no leadId, so the owner check below can never pass there.
      const isReporter = issue.reporterId === actorEmployeeId;
      const allowed =
        isReporter ||
        (await canCreateTask(this.prisma as any, companyId, actorEmployeeId, actorRole, project));
      if (!allowed) {
        throw new ForbiddenException('You do not have permission to assign members to this task');
      }
    }

    const existing = await this.prisma.issueMember.findUnique({
      where: {
        issueId_employeeId: { issueId, employeeId }
      }
    });

    if (existing) {
      await this.prisma.issueMember.delete({
        where: { issueId_employeeId: { issueId, employeeId } }
      });
      return { attached: false, employeeId };
    } else {
      const created = await this.prisma.issueMember.create({
        data: { issueId, employeeId },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } }, designation: { select: { name: true } } } }
        }
      });
      
      // Auto-add to project members if not already a member
      const isProjectMember = await this.prisma.projectMember.findUnique({
        where: { projectId_employeeId: { projectId, employeeId } }
      });
      if (!isProjectMember) {
        await this.prisma.projectMember.create({
          data: { projectId, employeeId, role: 'MEMBER' }
        });
      }

      return { attached: true, member: created };
    }
  }

  async uploadAttachmentToImageKit(companyId: number, employeeId: number, projectId: number, issueId: number, file: Express.Multer.File, requestedName?: string) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');
    if (!file) throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);

    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) throw new HttpException('ImageKit not configured', HttpStatus.INTERNAL_SERVER_ERROR);

    try {
      const ext = path.extname(file.originalname);
      const filename = `${crypto.randomBytes(12).toString('hex')}${ext}`;

      const form = new FormData();
      form.append('file', file.buffer.toString('base64'));
      form.append('fileName', filename);
      form.append('folder', '/card_attachments');

      const authHeader = 'Basic ' + Buffer.from(privateKey + ':').toString('base64');

      const response = await axios.post('https://upload.imagekit.io/api/v1/files/upload', form, {
        headers: {
          ...form.getHeaders(),
          Authorization: authHeader
        }
      });

      const fileUrl = response.data.url;

      return await this.prisma.issueAttachment.create({
        data: {
          // §2: the name the user gave it, when they renamed it before
          // saving. The extension is carried over from the real file either
          // way -- see renameKeepingExtension.
          fileName: resolveAttachmentName(file.originalname, requestedName),
          fileUrl,
          fileSize: file.size,
          fileType: 'FILE',
          issueId,
          uploadedBy: employeeId
        },
        include: { uploader: { select: { id: true, firstName: true, lastName: true } } }
      });
    } catch (error: any) {
      console.error('Attachment ImageKit upload error:', error.response?.data || error.message);
      throw new HttpException('Failed to upload file to ImageKit', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async addLinkAttachment(companyId: number, employeeId: number, projectId: number, issueId: number, linkUrl: string, linkName?: string) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');
    if (!linkUrl) throw new HttpException('Link URL is required', HttpStatus.BAD_REQUEST);

    let formattedUrl = linkUrl.trim();
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = 'https://' + formattedUrl;
    }

    return await this.prisma.issueAttachment.create({
      data: {
        fileName: (linkName && linkName.trim()) ? linkName.trim() : formattedUrl,
        fileUrl: formattedUrl,
        fileType: 'LINK',
        issueId,
        uploadedBy: employeeId
      },
      include: { uploader: { select: { id: true, firstName: true, lastName: true } } }
    });
  }

  /**
   * Rename a task attachment (§2).
   *
   * The stored file is untouched -- this is the name people read, not the
   * object in ImageKit. The extension is carried over from the real file, as
   * it is for project documents, so a rename cannot turn a PDF into something
   * the browser refuses to open.
   *
   * Anyone who may see the task may rename its evidence: naming a file you
   * uploaded so somebody can find it later is part of doing the work, not a
   * decision about it.
   */
  async renameAttachment(
    companyId: number,
    projectId: number,
    issueId: number,
    attachmentId: number,
    requestedName: string,
  ) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, companyId, projectId },
      select: { id: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');

    const attachment = await this.prisma.issueAttachment.findFirst({
      where: { id: attachmentId, issueId },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    if (!requestedName?.trim()) throw new BadRequestException('A file name is required');

    let fileName: string;
    try {
      fileName = renameKeepingExtension(attachment.fileName, requestedName);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    return this.prisma.issueAttachment.update({
      where: { id: attachmentId },
      data: { fileName },
      include: { uploader: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async deleteAttachment(companyId: number, projectId: number, issueId: number, attachmentId: number) {
    const attachment = await this.prisma.issueAttachment.findFirst({
      where: { id: attachmentId, issueId }
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    if (attachment.isCover) {
      await this.prisma.issue.update({
        where: { id: issueId },
        data: { coverUrl: null }
      });
    }

    // We can't delete from ImageKit because we don't have the fileId stored reliably.
    // However, since it is important to delete it, we could try to parse the fileId from the URL or query ImageKit
    // But for now, we'll just delete it from the DB to prevent crashes.

    await this.prisma.issueAttachment.delete({ where: { id: attachmentId } });
    return { success: true, attachmentId };
  }

  async toggleCoverAttachment(companyId: number, projectId: number, issueId: number, attachmentId: number) {
    const attachment = await this.prisma.issueAttachment.findFirst({
      where: { id: attachmentId, issueId }
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    const newCoverState = !attachment.isCover;

    if (newCoverState) {
      await this.prisma.issueAttachment.updateMany({
        where: { issueId },
        data: { isCover: false }
      });
    }

    await this.prisma.issueAttachment.update({
      where: { id: attachmentId },
      data: { isCover: newCoverState }
    });

    const updatedIssue = await this.prisma.issue.update({
      where: { id: issueId },
      data: { coverUrl: newCoverState ? attachment.fileUrl : null }
    });

    return { isCover: newCoverState, coverUrl: updatedIssue.coverUrl, attachmentId };
  }

  async reviewIssue(companyId: number, actorEmployeeId: number, projectId: number, issueId: number, data: { action: 'APPROVE' | 'REJECT', reason?: string }) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    const pm = await this.prisma.projectMember.findFirst({
      where: { projectId, employeeId: actorEmployeeId, role: 'PROJECT_MANAGER' }
    });
    if (!pm) {
      throw new ForbiddenException('Only Project Managers can review tasks.');
    }

    const board = await this.prisma.board.findFirst({
      where: { projectId },
      include: { columns: true }
    });
    if (!board) throw new BadRequestException('Project board not found');

    let targetColumn;
    let newStatus = '';
    
    if (data.action === 'APPROVE') {
      targetColumn = board.columns.find((c: any) => c.type === 'DONE');
      newStatus = 'DONE';
    } else {
      targetColumn = board.columns.find((c: any) => c.type === 'IN_PROGRESS');
      if (!targetColumn) targetColumn = board.columns.find((c: any) => c.type === 'TODO');
      newStatus = 'IN_PROGRESS';
    }

    if (!targetColumn) {
      throw new BadRequestException(`Could not find a target column for ${data.action} action`);
    }

    const updatedIssue = await this.prisma.issue.update({
      where: { id: issueId },
      data: {
        columnId: targetColumn.id,
        status: newStatus,
        rejectionReason: data.action === 'REJECT' ? data.reason : null
      }
    });

    const activity = await this.prisma.issueActivity.create({
      data: {
        action: data.action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        issueId,
        actorId: actorEmployeeId
      },
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      }
    });

    this.tasksGateway.emitIssueUpdated(issueId, projectId, updatedIssue);
    this.tasksGateway.emitActivityAdded(issueId, activity);

    return updatedIssue;
  }
}
