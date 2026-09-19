import {
  Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { allowedHours, remainingHours } from '../../tasks/task-hours';

/**
 * Additional-hours requests on a task, and their activity timeline (§3, §4).
 *
 * The task-level counterpart to BudgetRequestsService. The shape is
 * deliberately the same — raise, review, and a record of both — but the
 * approver differs: project budget is an administrator's call, while the hours
 * on one task belong to whoever manages that project.
 */
@Injectable()
export class TaskHoursRequestsService {
  private readonly logger = new Logger(TaskHoursRequestsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  private readonly ADMIN_ROLES = ['SUPERADMIN', 'ADMIN'];

  /** Statuses a request can sit in before anybody has ruled on it. */
  private readonly OPEN = 'REQUESTED';

  private readonly SELECT = {
    id: true, requestedHours: true, approvedHours: true, reason: true,
    status: true, reviewedAt: true, rejectionReason: true,
    createdAt: true, updatedAt: true,
    requestedBy: { select: { id: true, firstName: true, lastName: true } },
    reviewedBy: { select: { id: true, firstName: true, lastName: true } },
    issue: {
      select: {
        id: true, key: true, title: true,
        estimatedHours: true, additionalHours: true, assigneeId: true,
        project: { select: { id: true, name: true, key: true, leadId: true } },
      },
    },
  } as const;

  /** The task, with everything both the permission test and the sums need. */
  private async loadIssue(companyId: number, issueId: number) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, companyId },
      select: {
        id: true, key: true, title: true, assigneeId: true, reporterId: true,
        estimatedHours: true, additionalHours: true,
        project: {
          select: {
            id: true, name: true, leadId: true,
            members: { select: { employeeId: true, role: true } },
          },
        },
      },
    });
    if (!issue) throw new NotFoundException('Task not found');
    return issue;
  }

  /**
   * Who may approve: the project's manager, or an administrator.
   *
   * Not the requester, even when they manage the project — approving your own
   * request for more time is not an approval, and a PM raising one on their
   * own task is an ordinary thing to do.
   */
  private managesProject(issue: any, employeeId: number | null): boolean {
    if (employeeId == null) return false;
    if (issue.project?.leadId === employeeId) return true;
    return (issue.project?.members || []).some(
      (m: any) => m.employeeId === employeeId && m.role === 'PROJECT_MANAGER',
    );
  }

  private mayApprove(issue: any, role: string, employeeId: number | null): boolean {
    return this.ADMIN_ROLES.includes(role) || this.managesProject(issue, employeeId);
  }

  /**
   * The people a request is actually waiting on: the project's lead and its
   * project managers. Deliberately the same set `managesProject` tests, so the
   * request cannot land in the queue of someone who is then refused the
   * decision — nor stay silent for someone who can make it.
   *
   * Administrators may also approve, but they are not notified: they can
   * approve on any project in the company, and a company-wide broadcast for
   * every task's hours is noise, not an approval queue.
   */
  private approverEmployeeIds(issue: any): number[] {
    const ids = new Set<number>();
    if (issue.project?.leadId) ids.add(issue.project.leadId);
    for (const m of issue.project?.members || []) {
      if (m.role === 'PROJECT_MANAGER' && m.employeeId) ids.add(m.employeeId);
    }
    return [...ids];
  }

  /** Where a request is actioned — the §4 cross-project decision queue. */
  private readonly REQUESTS_LINK = '/task-requests';

  /** Who may ask: whoever is doing the work, or anybody on the project. */
  private mayRequest(issue: any, role: string, employeeId: number | null): boolean {
    if (employeeId == null) return false;
    if (issue.assigneeId === employeeId) return true;
    if (this.mayApprove(issue, role, employeeId)) return true;
    return (issue.project?.members || []).some((m: any) => m.employeeId === employeeId);
  }

  /** Total minutes logged against a task. */
  private async loggedMinutes(issueId: number): Promise<number> {
    const agg = await this.prisma.issueTimeLog.aggregate({
      where: { issueId }, _sum: { durationMin: true },
    });
    return agg._sum.durationMin ?? 0;
  }

  /** One task's requests, plus where its hours currently stand. */
  async listForIssue(companyId: number, issueId: number, role: string, employeeId: number | null) {
    const issue = await this.loadIssue(companyId, issueId);
    const [requests, loggedMinutes] = await Promise.all([
      this.prisma.taskHoursRequest.findMany({
        where: { companyId, issueId },
        orderBy: { createdAt: 'desc' },
        select: this.SELECT,
      }),
      this.loggedMinutes(issueId),
    ]);

    const state = {
      estimatedHours: issue.estimatedHours,
      additionalHours: issue.additionalHours ?? 0,
      loggedMinutes,
    };

    return {
      requests,
      hours: {
        assigned: issue.estimatedHours,
        additional: issue.additionalHours ?? 0,
        allowed: allowedHours(state),
        logged: Math.round((loggedMinutes / 60) * 100) / 100,
        remaining: remainingHours(state),
      },
      canRequest: this.mayRequest(issue, role, employeeId),
      canApprove: this.mayApprove(issue, role, employeeId),
    };
  }

  /**
   * An employee asks for more time on a task (§3).
   *
   * One open request at a time. A second would leave the approver ruling on
   * stale numbers and make "how many hours does this task have" depend on the
   * order the decisions happened to arrive in.
   */
  async create(
    companyId: number,
    employeeId: number | null,
    role: string,
    issueId: number,
    data: { requestedHours: unknown; reason?: string },
  ) {
    const issue = await this.loadIssue(companyId, issueId);
    if (!this.mayRequest(issue, role, employeeId)) {
      throw new ForbiddenException('You cannot request more hours on this task');
    }

    const requestedHours = Number(data?.requestedHours);
    if (!Number.isFinite(requestedHours) || requestedHours <= 0) {
      throw new BadRequestException('Ask for a positive number of additional hours');
    }

    const reason = (data?.reason || '').trim();
    if (!reason) {
      throw new BadRequestException('A reason is required — it is what the approver rules on');
    }

    const open = await this.prisma.taskHoursRequest.findFirst({
      where: { companyId, issueId, status: this.OPEN },
      select: { id: true },
    });
    if (open) {
      throw new BadRequestException(
        'There is already an additional-hours request awaiting a decision on this task',
      );
    }

    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.taskHoursRequest.create({
        data: {
          issueId, companyId,
          requestedById: employeeId as number,
          requestedHours,
          reason,
          status: this.OPEN,
        },
        select: this.SELECT,
      });

      await tx.taskHoursRequestActivity.create({
        data: {
          requestId: created.id,
          action: 'CREATED',
          detail: `Requested ${requestedHours}h`,
          newValue: String(requestedHours),
          actorId: employeeId as number,
        },
      });

      return created;
    });

    // After the commit, never inside it: notifyEmployees swallows its own
    // errors, but a push round trip has no business holding a database
    // transaction open, and a notification for a request that then rolled back
    // would point at nothing.
    await this.notifyRaised(companyId, issue, request, employeeId);

    return request;
  }

  /**
   * Tell the project's approvers that somebody is waiting on them (§3).
   *
   * ACTION_REQUIRED because the requester is blocked until this is ruled on —
   * that is precisely the notification a mute must not swallow.
   */
  private async notifyRaised(
    companyId: number, issue: any, request: any, requesterId: number | null,
  ) {
    const approvers = this.approverEmployeeIds(issue);
    const who = `${request.requestedBy?.firstName ?? ''} ${request.requestedBy?.lastName ?? ''}`.trim()
      || 'Someone';

    const reached = await this.notifications.notifyEmployees(approvers, {
      companyId,
      excludeEmployeeId: requesterId,
      title: 'Additional hours requested',
      message: `${who} asked for ${request.requestedHours}h more on ${issue.key} — ${issue.title}.`,
      type: 'ACTION_REQUIRED',
      linkUrl: this.REQUESTS_LINK,
    });

    // A project with no lead and no PM leaves the request sitting in a queue
    // nobody is watching. It still has to be approved, so say so here rather
    // than let it age silently.
    if (reached === 0) {
      this.logger.warn(
        `Additional-hours request ${request.id} on ${issue.key} reached no approver — ` +
        `project ${issue.project?.id} has no lead or project manager other than the requester.`,
      );
    }
  }

  /** Tell the requester what was decided, and where the task is. */
  private async notifyDecided(
    companyId: number, issue: any, request: any,
    decision: 'APPROVED' | 'REJECTED', reviewerId: number | null, detail: string,
  ) {
    await this.notifications.notifyEmployees([request.requestedBy?.id], {
      companyId,
      excludeEmployeeId: reviewerId,
      title: decision === 'APPROVED' ? 'Additional hours approved' : 'Additional hours declined',
      message: `${issue.key} — ${issue.title}: ${detail}`,
      type: decision === 'APPROVED' ? 'SUCCESS' : 'WARNING',
      linkUrl: `/projects/${issue.project?.id}?task=${issue.id}`,
    });
  }

  /**
   * Approve or reject (§3).
   *
   * Approving raises the task's ceiling in the same transaction that records
   * the decision: an approval that did not move `additionalHours` would be an
   * approval nobody honoured, and a raised ceiling with no approved request
   * behind it would be hours nobody can account for.
   */
  async review(
    companyId: number,
    reviewerEmployeeId: number | null,
    role: string,
    requestId: number,
    decision: 'APPROVED' | 'REJECTED',
    data: { approvedHours?: unknown; reason?: string } = {},
  ) {
    const request = await this.prisma.taskHoursRequest.findFirst({
      where: { id: requestId, companyId },
      select: { id: true, issueId: true, status: true, requestedHours: true, requestedById: true },
    });
    if (!request) throw new NotFoundException('Request not found');

    const issue = await this.loadIssue(companyId, request.issueId);
    if (!this.mayApprove(issue, role, reviewerEmployeeId)) {
      throw new ForbiddenException('Only the project manager approves additional hours');
    }
    if (reviewerEmployeeId != null && request.requestedById === reviewerEmployeeId) {
      throw new ForbiddenException('You cannot approve your own request for more hours');
    }
    if (request.status !== this.OPEN) {
      throw new BadRequestException(`This request is already ${request.status.toLowerCase()}`);
    }

    if (decision === 'REJECTED') {
      const reason = (data?.reason || '').trim();
      if (!reason) {
        throw new BadRequestException('A reason is required when rejecting a request');
      }
      const rejected = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.taskHoursRequest.update({
          where: { id: requestId },
          data: {
            status: 'REJECTED',
            reviewedById: reviewerEmployeeId,
            reviewedAt: new Date(),
            rejectionReason: reason,
          },
          select: this.SELECT,
        });
        await tx.taskHoursRequestActivity.create({
          data: {
            requestId, action: 'REJECTED', detail: reason,
            actorId: reviewerEmployeeId as number,
          },
        });
        return updated;
      });

      await this.notifyDecided(
        companyId, issue, rejected, 'REJECTED', reviewerEmployeeId,
        `your request for ${rejected.requestedHours}h was declined — ${reason}`,
      );
      return rejected;
    }

    // The PM may grant less than was asked for. Null means "grant what was
    // requested", which is the ordinary case and should not need retyping.
    let approvedHours = request.requestedHours;
    if (data?.approvedHours != null && data.approvedHours !== '') {
      const n = Number(data.approvedHours);
      if (!Number.isFinite(n) || n <= 0) {
        throw new BadRequestException('Approved hours must be a positive number');
      }
      approvedHours = n;
    }

    const approved = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.taskHoursRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          approvedHours,
          reviewedById: reviewerEmployeeId,
          reviewedAt: new Date(),
        },
        select: this.SELECT,
      });

      // Read inside the transaction: another approval on the same task may
      // have landed since this request was raised.
      const current = await tx.issue.findUnique({
        where: { id: request.issueId },
        select: { additionalHours: true },
      });
      await tx.issue.update({
        where: { id: request.issueId },
        data: { additionalHours: (current?.additionalHours ?? 0) + approvedHours },
      });

      if (approvedHours !== request.requestedHours) {
        await tx.taskHoursRequestActivity.create({
          data: {
            requestId, action: 'HOURS_MODIFIED',
            detail: `${request.requestedHours}h requested → ${approvedHours}h approved`,
            oldValue: String(request.requestedHours),
            newValue: String(approvedHours),
            actorId: reviewerEmployeeId as number,
          },
        });
      }
      await tx.taskHoursRequestActivity.create({
        data: {
          requestId, action: 'APPROVED',
          detail: `Approved ${approvedHours}h`,
          newValue: String(approvedHours),
          actorId: reviewerEmployeeId as number,
        },
      });

      return updated;
    });

    // Says what was granted rather than just "approved": the PM may have
    // granted fewer hours than were asked for, and that is the number the
    // requester has to work to.
    await this.notifyDecided(
      companyId, issue, approved, 'APPROVED', reviewerEmployeeId,
      approvedHours === request.requestedHours
        ? `your request for ${approvedHours}h was approved`
        : `${request.requestedHours}h requested, ${approvedHours}h approved`,
    );
    return approved;
  }

  /** One request's full history, oldest first — the §4 timeline. */
  async timeline(companyId: number, requestId: number) {
    const request = await this.prisma.taskHoursRequest.findFirst({
      where: { id: requestId, companyId },
      select: { id: true },
    });
    if (!request) throw new NotFoundException('Request not found');

    return this.prisma.taskHoursRequestActivity.findMany({
      where: { requestId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, action: true, detail: true, oldValue: true, newValue: true,
        createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  /**
   * Every request across the company, for the §4 tracking screen.
   *
   * A plain member sees only their own. Seeing what everybody has asked for is
   * a manager's view, and the reasons people give are written for the approver.
   */
  async listAll(
    companyId: number,
    role: string,
    employeeId: number | null,
    filters: { status?: string; projectId?: string } = {},
  ) {
    const where: any = { companyId };
    if (filters.status && filters.status !== 'ALL') where.status = filters.status;
    if (filters.projectId && filters.projectId !== 'ALL') {
      where.issue = { projectId: Number(filters.projectId) };
    }

    if (!this.ADMIN_ROLES.includes(role)) {
      const managed = await this.prisma.projectMember.findMany({
        where: { employeeId: employeeId ?? -1, role: 'PROJECT_MANAGER' },
        select: { projectId: true },
      });
      const led = await this.prisma.project.findMany({
        where: { companyId, leadId: employeeId ?? -1 },
        select: { id: true },
      });
      const projectIds = [
        ...managed.map((m) => m.projectId),
        ...led.map((p) => p.id),
      ];
      where.OR = [
        { requestedById: employeeId ?? -1 },
        ...(projectIds.length ? [{ issue: { projectId: { in: projectIds } } }] : []),
      ];
    }

    return this.prisma.taskHoursRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: this.SELECT,
    });
  }
}
