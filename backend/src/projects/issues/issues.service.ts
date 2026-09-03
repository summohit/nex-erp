import { Injectable, NotFoundException, HttpException, HttpStatus, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import axios from 'axios';
import * as path from 'path';
import * as crypto from 'crypto';
import FormData from 'form-data';
import { TasksGateway } from '../../events/tasks/tasks.gateway';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class IssuesService {
  constructor(
    private prisma: PrismaService,
    private tasksGateway: TasksGateway,
    private notificationsService: NotificationsService
  ) {}

  async createIssue(companyId: number, reporterId: number, projectId: number, data: any, role?: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId, companyId } });
    if (!project) throw new NotFoundException('Project not found');

    if (!(role === 'SUPERADMIN' || role === 'ADMIN') && project.leadId !== reporterId) {
      throw new ForbiddenException('Only the project owner can create tasks');
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
        await this.assertCanCompleteOrArchive(companyId, reporterId, { projectId, assigneeId: data.assigneeId ? Number(data.assigneeId) : null });
      }
    }

    // Get max position in that column
    const lastIssue = await this.prisma.issue.findFirst({
      where: { columnId },
      orderBy: { position: 'desc' }
    });
    const position = lastIssue ? lastIssue.position + 1 : 0;

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
        parentId: data.parentId ? Number(data.parentId) : null
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

  private async assertCanCompleteOrArchive(companyId: number, actorEmployeeId: number, issue: any) {
    const project = issue.projectId
      ? await this.prisma.project.findUnique({ where: { id: issue.projectId }, select: { leadId: true } })
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
        throw new ForbiddenException('Only the project owner can move a task assigned to a Project Manager into this stage.');
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
        throw new ForbiddenException('Only managers (or the assignee\'s upper hierarchy) can move a task to Done or archive it.');
      }
      return;
    }

    if (actorEmployeeId === issue.assigneeId) {
      throw new ForbiddenException('The assignee cannot move this task to Done. Only their manager (or above) can.');
    }

    const hierarchy = await this.getAssigneeUpperHierarchy(companyId, issue.assigneeId);
    if (!hierarchy.includes(actorEmployeeId)) {
      throw new ForbiddenException('Only the assignee\'s manager (or above) can move this task to Done or archive it.');
    }
  }

  async updateIssue(companyId: number, employeeId: number, projectId: number, issueId: number, data: any, role?: string) {
    const oldIssue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!oldIssue) throw new NotFoundException('Issue not found');

    // Editing task content (title/description/priority) is restricted to the project owner.
    // Moving cards between columns / changing status remains open to all members.
    if (data.title !== undefined || data.description !== undefined || data.priority !== undefined) {
      if (!(role === 'SUPERADMIN' || role === 'ADMIN')) {
        const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId }, select: { leadId: true } });
        if (!project) throw new NotFoundException('Project not found');
        if (project.leadId !== employeeId) {
          throw new ForbiddenException('Only the project owner can edit task content');
        }
      }
    }

    const prevStatus = oldIssue.status;

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
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
            throw new ForbiddenException('Cannot skip columns. Move one column at a time.');
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
      await this.assertCanCompleteOrArchive(companyId, employeeId, oldIssue);
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

  async toggleArchive(companyId: number, employeeId: number, projectId: number, issueId: number) {
    const oldIssue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!oldIssue) throw new NotFoundException('Issue not found');

    if (!oldIssue.isArchived) {
      await this.assertCanCompleteOrArchive(companyId, employeeId, oldIssue);
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

  async startTimeTracking(companyId: number, userId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');
    const employeeId = await this.resolveEmployeeId(companyId, userId);

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
    const employeeId = await this.resolveEmployeeId(companyId, userId);

    const now = new Date();
    const startedAt = new Date(now.getTime() - data.durationMin * 60000);

    const log = await this.prisma.issueTimeLog.create({
      data: {
        issueId,
        employeeId,
        startedAt,
        endedAt: now,
        durationMin: data.durationMin
      }
    });

    await this.prisma.issueActivity.create({
      data: { action: 'TIME_LOGGED', issueId, actorId: employeeId }
    });

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

  async createChecklist(companyId: number, projectId: number, issueId: number, title: string) {
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

  async updateChecklist(companyId: number, projectId: number, issueId: number, checklistId: number, title: string) {
    const checklist = await this.prisma.checklist.findUnique({ where: { id: checklistId, issueId } });
    if (!checklist) throw new NotFoundException('Checklist not found');

    return this.prisma.checklist.update({
      where: { id: checklistId },
      data: { title: title || 'Checklist' }
    });
  }

  async deleteChecklist(companyId: number, projectId: number, issueId: number, checklistId: number) {
    const checklist = await this.prisma.checklist.findUnique({ where: { id: checklistId, issueId } });
    if (!checklist) throw new NotFoundException('Checklist not found');

    return this.prisma.checklist.delete({
      where: { id: checklistId }
    });
  }

  async addChecklistItem(companyId: number, projectId: number, issueId: number, checklistId: number, title: string) {
    const checklist = await this.prisma.checklist.findUnique({ where: { id: checklistId, issueId } });
    if (!checklist) throw new NotFoundException('Checklist not found');

    return this.prisma.checklistItem.create({
      data: {
        title,
        checklistId
      }
    });
  }

  async updateChecklistItem(companyId: number, projectId: number, issueId: number, checklistId: number, itemId: number, data: any) {
    const item = await this.prisma.checklistItem.findFirst({ where: { id: itemId, checklistId } });
    if (!item) throw new NotFoundException('Checklist item not found');

    const updateData: any = {};
    if (data.isCompleted !== undefined) updateData.isCompleted = Boolean(data.isCompleted);
    if (data.title !== undefined) updateData.title = data.title;

    return this.prisma.checklistItem.update({
      where: { id: itemId },
      data: updateData
    });
  }

  async deleteChecklistItem(companyId: number, projectId: number, issueId: number, checklistId: number, itemId: number) {
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
      if (project && project.leadId !== actorEmployeeId) {
        throw new ForbiddenException('Only the project owner can assign members to a task');
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

  async uploadAttachmentToImageKit(companyId: number, employeeId: number, projectId: number, issueId: number, file: Express.Multer.File) {
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
          fileName: file.originalname,
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
