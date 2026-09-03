import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Department-name fragments that identify the software development team,
 * most specific first — "Software Development" wins over a generic "Engineering".
 */
const DEV_DEPT_KEYWORDS = [
  'software development',
  'software',
  'development',
  'engineering',
  'information technology',
  'it support',
  'tech',
];

const EMPLOYEE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  designation: { select: { name: true } },
  department: { select: { id: true, name: true } },
};

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private notificationsService: NotificationsService,
  ) {}

  private async nextTicketNumber(companyId: number): Promise<string> {
    const count = await this.prisma.ticket.count({ where: { companyId } });
    return `TKT-${String(count + 1).padStart(3, '0')}`;
  }

  private async defaultAssigneeId(companyId: number): Promise<number | null> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { companyId },
      select: { defaultTicketAssigneeId: true },
    });
    return setting?.defaultTicketAssigneeId ?? null;
  }

  /**
   * Every ticket routes to the software development team, so the reporter never
   * picks a department. Resolved from the configured default assignee's own
   * department first; falls back to matching the department by name.
   */
  private async devDepartmentId(companyId: number, assigneeId: number | null): Promise<number> {
    if (assigneeId) {
      const assignee = await this.prisma.employee.findFirst({
        where: { id: assigneeId, companyId },
        select: { departmentId: true },
      });
      if (assignee?.departmentId) return assignee.departmentId;
    }

    const departments = await this.prisma.department.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });

    // Walk the keywords in priority order so the most specific name wins.
    for (const keyword of DEV_DEPT_KEYWORDS) {
      const match = departments.find((d) => d.name.toLowerCase().includes(keyword));
      if (match) return match.id;
    }

    if (!departments.length) {
      throw new BadRequestException('No departments configured for this company');
    }
    return departments[0].id;
  }

  /**
   * The department a ticket is raised on behalf of. A supplied value is honoured
   * only if it is a real department in this company; otherwise we fall back to
   * the reporter's own, so the field can never be forged into a bogus id.
   */
  private async resolveRaisedByDept(
    companyId: number,
    reporterId: number,
    supplied?: number | string | null,
  ): Promise<number | null> {
    if (supplied) {
      const dept = await this.prisma.department.findFirst({
        where: { id: Number(supplied), companyId },
        select: { id: true },
      });
      if (dept) return dept.id;
    }

    const reporter = await this.prisma.employee.findFirst({
      where: { id: reporterId, companyId },
      select: { departmentId: true },
    });
    return reporter?.departmentId ?? null;
  }

  // ─── CREATE ────────────────────────────────────────────────────────────────

  async create(companyId: number, reporterId: number, data: any) {
    const ticketNumber = await this.nextTicketNumber(companyId);
    const assigneeId = await this.defaultAssigneeId(companyId);
    
    // The owning team is always software development — the reporter never picks it.
    const departmentId = await this.devDepartmentId(companyId, assigneeId);

    // Which department the issue is raised on behalf of. Selectable (IT may log a
    // bug for Finance), defaulting to the reporter's own department.
    const raisedByDepartmentId = await this.resolveRaisedByDept(
      companyId,
      reporterId,
      data.raisedByDepartmentId,
    );

    const attachments: { fileName: string; fileUrl: string; fileSize?: number | null }[] =
      Array.isArray(data.attachments) ? data.attachments : [];

    const ticket = await this.prisma.ticket.create({
      data: {
        ticketNumber,
        title: data.title,
        description: data.description ?? null,
        type: data.type ?? 'BUG',
        priority: data.priority ?? 'MEDIUM',
        platform: data.platform ?? 'WEB',
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        companyId,
        departmentId,
        raisedByDepartmentId,
        reporterId,
        assigneeId: assigneeId ? Number(assigneeId) : null,
        attachments: attachments.length
          ? {
              create: attachments.map((a) => ({
                fileName: a.fileName,
                fileUrl: a.fileUrl,
                fileSize: a.fileSize ?? null,
                uploadedById: reporterId,
              })),
            }
          : undefined,
      },
      include: {
        reporter: { select: EMPLOYEE_SELECT },
        assignee: { select: EMPLOYEE_SELECT },
        department: true,
        raisedByDepartment: { select: { id: true, name: true } },
        attachments: true,
        _count: { select: { comments: true } },
      },
    });

    if (assigneeId) {
      await this.prisma.ticketActivity.create({
        data: {
          ticketId: ticket.id,
          actorId: reporterId,
          action: 'ASSIGNED',
          field: 'assigneeId',
          newValue: String(assigneeId),
        },
      });
      
      const newAssignee = await this.prisma.employee.findFirst({
        where: { id: Number(assigneeId) },
        select: { user: { select: { email: true } } }
      });
      if (newAssignee?.user?.email) {
        this.mailService.sendTicketAssignedEmail(newAssignee.user.email, ticket.ticketNumber, ticket.title).catch(console.error);
      }

      await this.notifyTicketParticipants([Number(assigneeId)], reporterId, companyId, {
        title: 'New Ticket Assigned',
        message: `${ticket.ticketNumber}: ${ticket.title}`,
        type: 'ASSIGNMENT',
      });
    }

    return ticket;
  }

  // ─── ASSIGNABLE MEMBERS ────────────────────────────────────────────────────

  /** Employees in the ticket's own department — the only valid reassignment targets. */
  async assignableMembers(companyId: number, ticketId: number) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, companyId },
      select: { departmentId: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const members = await this.prisma.employee.findMany({
      where: { companyId, departmentId: ticket.departmentId, offboardingStatus: { not: 'SEPARATED' } },
      select: EMPLOYEE_SELECT,
      orderBy: { firstName: 'asc' },
    });
    if (members.length) return members;

    // The ticket's department is empty (e.g. it was routed to a placeholder
    // department before one existed). Fall back to the real dev team so the
    // ticket can still be assigned to someone.
    const devDeptId = await this.devDepartmentId(companyId, null);
    if (devDeptId === ticket.departmentId) return members;

    return this.prisma.employee.findMany({
      where: { companyId, departmentId: devDeptId, offboardingStatus: { not: 'SEPARATED' } },
      select: EMPLOYEE_SELECT,
      orderBy: { firstName: 'asc' },
    });
  }

  // ─── LIST ──────────────────────────────────────────────────────────────────

  private canSeeAllTickets(role?: string): boolean {
    return ['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(role ?? '');
  }

  private async isEngineeringDept(employeeId: number | null | undefined): Promise<boolean> {
    if (!employeeId) return false;
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { department: { select: { name: true } } },
    });
    const name = emp?.department?.name?.toLowerCase() ?? '';
    return DEV_DEPT_KEYWORDS.some((k) => name.includes(k));
  }

  /**
   * What the current user is allowed to do with tickets. The JWT carries no
   * department, so this is resolved server-side and handed to the UI, which
   * uses it to decide whether to render triage controls at all.
   */
  async myPermissions(companyId: number, user: { role?: string; employeeId?: number | null }) {
    const isManagement = this.canSeeAllTickets(user.role);
    const isDevTeam = await this.isEngineeringDept(user.employeeId);

    const employee = user.employeeId
      ? await this.prisma.employee.findFirst({
          where: { id: user.employeeId, companyId },
          select: { departmentId: true, department: { select: { name: true } } },
        })
      : null;

    return {
      // Triage rights: change status, reassign within the team.
      canManage: isManagement || isDevTeam,
      isDevTeam,
      isManagement,
      employeeId: user.employeeId ?? null,
      departmentId: employee?.departmentId ?? null,
      departmentName: employee?.department?.name ?? null,
    };
  }

  async findAll(companyId: number, user: { role?: string; employeeId?: number | null; departmentId?: number | null }, filters: any) {
    const where: any = { companyId };

    const privileged = this.canSeeAllTickets(user.role) || (await this.isEngineeringDept(user.employeeId));
    if (!privileged && user.employeeId) {
      where.reporterId = user.employeeId;
    }

    // "Department" means the one the ticket was raised BY — the owning team is
    // always software development, so filtering on it would be meaningless.
    if (filters.departmentId) {
      where.raisedByDepartmentId = Number(filters.departmentId);
    }
    if (filters.status) where.status = filters.status;
    if (filters.priority) where.priority = filters.priority;
    if (filters.platform) where.platform = filters.platform;
    if (filters.type) where.type = filters.type;
    if (filters.assigneeId) where.assigneeId = Number(filters.assigneeId);
    if (filters.reporterId) where.reporterId = Number(filters.reporterId);

    if (filters.fromDate || filters.toDate) {
      where.createdAt = {};
      if (filters.fromDate) where.createdAt.gte = new Date(filters.fromDate);
      if (filters.toDate) where.createdAt.lte = new Date(filters.toDate);
    }

    if (filters.dueDateFrom || filters.dueDateTo) {
      where.dueDate = {};
      if (filters.dueDateFrom) where.dueDate.gte = new Date(filters.dueDateFrom);
      if (filters.dueDateTo) where.dueDate.lte = new Date(filters.dueDateTo);
    }
    
    if (filters.deadline === 'overdue') {
      where.dueDate = { lt: new Date() };
      where.status = { notIn: ['RESOLVED', 'CLOSED'] };
    }

    return this.prisma.ticket.findMany({
      where,
      include: {
        reporter: { select: EMPLOYEE_SELECT },
        assignee: { select: EMPLOYEE_SELECT },
        department: { select: { id: true, name: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── STATS ─────────────────────────────────────────────────────────────────

  async getStats(companyId: number, user: { role?: string; employeeId?: number | null; departmentId?: number | null }) {
    const where: any = { companyId };
    const privileged = this.canSeeAllTickets(user.role) || (await this.isEngineeringDept(user.employeeId));
    if (!privileged && user.employeeId) where.reporterId = user.employeeId;

    const [total, open, inProgress, resolved, closed] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.count({ where: { ...where, status: 'OPEN' } }),
      this.prisma.ticket.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      this.prisma.ticket.count({ where: { ...where, status: 'RESOLVED' } }),
      this.prisma.ticket.count({ where: { ...where, status: 'CLOSED' } }),
    ]);

    const byDepartment = await this.prisma.ticket.groupBy({
      by: ['departmentId'],
      where,
      _count: { id: true },
    });

    const departmentIds = byDepartment.map((r) => r.departmentId);
    const departments = await this.prisma.department.findMany({
      where: { id: { in: departmentIds } },
      select: { id: true, name: true },
    });
    const deptMap = Object.fromEntries(departments.map((d) => [d.id, d.name]));

    return {
      total,
      open,
      inProgress,
      resolved,
      closed,
      byDepartment: byDepartment.map((r) => ({
        departmentId: r.departmentId,
        departmentName: deptMap[r.departmentId] ?? 'Unknown',
        count: r._count.id,
      })),
    };
  }

  // ─── FIND ONE ──────────────────────────────────────────────────────────────

  async findOne(companyId: number, id: number) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, companyId },
      include: {
        reporter: { select: EMPLOYEE_SELECT },
        assignee: { select: EMPLOYEE_SELECT },
        department: true,
        raisedByDepartment: { select: { id: true, name: true } },
        comments: {
          include: { author: { select: EMPLOYEE_SELECT } },
          orderBy: { createdAt: 'asc' },
        },
        attachments: {
          include: { uploadedBy: { select: EMPLOYEE_SELECT } },
          orderBy: { createdAt: 'desc' },
        },
        activities: {
          include: { actor: { select: EMPLOYEE_SELECT } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  // ─── UPDATE ────────────────────────────────────────────────────────────────

  async update(
    companyId: number,
    id: number,
    actorId: number,
    data: any,
    user: { role?: string; employeeId?: number | null },
  ) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id, companyId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    // Triage (status, priority, assignment) belongs to the dev team and management.
    // The one exception: once the team marks a ticket RESOLVED, the person who
    // raised it may close it off themselves — and nothing else.
    const { canManage } = await this.myPermissions(companyId, user);
    if (!canManage) {
      const isReporter = !!user.employeeId && ticket.reporterId === user.employeeId;
      const closingOnly =
        Object.keys(data).length === 1 && (data.status === 'CLOSED' || data.status === 'IN_PROGRESS');

      const mayClose =
        isReporter && ticket.status === 'RESOLVED' && Object.keys(data).length === 1 && data.status === 'CLOSED';

      if (!mayClose) {
        throw new ForbiddenException(
          closingOnly && isReporter
            ? 'You can only close this ticket once the team marks it Resolved'
            : 'Only the software development team can update tickets',
        );
      }
    }

    const updateData: any = {};

    // Reassignment stays within the ticket's own department — except when that
    // department has no members, in which case the ticket follows the assignee
    // to the real dev team (see assignableMembers).
    if (data.assigneeId) {
      const candidate = await this.prisma.employee.findFirst({
        where: { id: Number(data.assigneeId), companyId },
        select: { departmentId: true },
      });
      if (!candidate) throw new NotFoundException('Assignee not found');

      if (candidate.departmentId !== ticket.departmentId) {
        const currentDeptHasMembers = await this.prisma.employee.count({
          where: { companyId, departmentId: ticket.departmentId, offboardingStatus: { not: 'SEPARATED' } },
        });
        const devDeptId = await this.devDepartmentId(companyId, null);

        if (currentDeptHasMembers > 0 || candidate.departmentId !== devDeptId) {
          throw new ForbiddenException('Tickets can only be reassigned within the same department');
        }
        updateData.departmentId = candidate.departmentId;
      }
    }

    const activities: any[] = [];

    const trackChange = (field: string, raw: any, cast?: (v: any) => any) => {
      if (raw === undefined) return;
      const newVal = cast ? cast(raw) : raw;
      if (String(ticket[field]) !== String(newVal)) {
        activities.push({ ticketId: id, actorId, action: `${field.toUpperCase()}_CHANGED`, field, oldValue: String(ticket[field] ?? ''), newValue: String(newVal ?? '') });
      }
      updateData[field] = newVal;
    };

    trackChange('status', data.status);
    trackChange('priority', data.priority);
    trackChange('type', data.type);
    trackChange('platform', data.platform);
    trackChange('assigneeId', data.assigneeId, (v) => (v ? Number(v) : null));
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (data.departmentId !== undefined) updateData.departmentId = Number(data.departmentId);

    if (data.status === 'RESOLVED' && ticket.status !== 'RESOLVED') updateData.resolvedAt = new Date();
    if ((data.status === 'CLOSED' || data.status === 'REJECTED') && !['CLOSED', 'REJECTED'].includes(ticket.status)) updateData.closedAt = new Date();

    const [updated] = await this.prisma.$transaction([
      this.prisma.ticket.update({
        where: { id },
        data: updateData,
        include: { reporter: { select: EMPLOYEE_SELECT }, assignee: { select: EMPLOYEE_SELECT }, department: true },
      }),
      ...activities.map((a) => this.prisma.ticketActivity.create({ data: a })),
    ]);

    if (data.assigneeId && String(ticket.assigneeId) !== String(data.assigneeId)) {
      const newAssignee = await this.prisma.employee.findFirst({
        where: { id: Number(data.assigneeId) },
        select: { user: { select: { email: true } } }
      });
      if (newAssignee?.user?.email) {
        this.mailService.sendTicketAssignedEmail(newAssignee.user.email, updated.ticketNumber, updated.title).catch(console.error);
      }

      await this.notifyTicketParticipants([Number(data.assigneeId)], actorId, companyId, {
        title: 'Ticket Assigned to You',
        message: `${updated.ticketNumber}: ${updated.title}`,
        type: 'ASSIGNMENT',
      });
    }

    // Status moves are what the reporter is actually waiting on. RESOLVED is
    // special: only the reporter can close it from there, so the notification
    // has to say so or the ticket sits resolved-but-open indefinitely.
    if (data.status !== undefined && data.status !== ticket.status) {
      const resolvedForReporter = data.status === 'RESOLVED';
      const label = String(data.status).replace('_', ' ').toLowerCase();

      await this.notifyTicketParticipants([ticket.reporterId], actorId, companyId, {
        title: resolvedForReporter ? 'Your Ticket Is Resolved' : `Ticket ${label}`,
        message: resolvedForReporter
          ? `${updated.ticketNumber}: ${updated.title} — please confirm and close it if you are happy with the fix.`
          : `${updated.ticketNumber}: ${updated.title} is now ${label}.`,
        type: resolvedForReporter ? 'ACTION_REQUIRED' : 'INFO',
      });

      // The assignee also needs to know when someone else moves their ticket —
      // most often the reporter closing it after a fix.
      if (updated.assigneeId && updated.assigneeId !== ticket.reporterId) {
        await this.notifyTicketParticipants([updated.assigneeId], actorId, companyId, {
          title: `Ticket ${label}`,
          message: `${updated.ticketNumber}: ${updated.title} is now ${label}.`,
          type: 'INFO',
        });
      }
    }

    return updated;
  }

  // ─── DELETE ────────────────────────────────────────────────────────────────

  async remove(companyId: number, id: number, user: { role?: string; employeeId?: number | null }) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id, companyId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const isAdmin = user.role === 'SUPERADMIN' || user.role === 'ADMIN';
    if (!isAdmin && ticket.reporterId !== user.employeeId) {
      throw new ForbiddenException('Only admins or the reporter can delete a ticket');
    }

    await this.prisma.ticket.delete({ where: { id } });
    return { success: true };
  }

  // ─── COMMENTS ──────────────────────────────────────────────────────────────

  async addComment(companyId: number, ticketId: number, authorId: number, body: string) {
    // Needs the participants, not just existence — a reply is pointless if the
    // other side is never told about it.
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, companyId },
      select: { ticketNumber: true, title: true, reporterId: true, assigneeId: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const [comment] = await this.prisma.$transaction([
      this.prisma.ticketComment.create({
        data: { ticketId, authorId, body },
        include: { author: { select: EMPLOYEE_SELECT } },
      }),
      this.prisma.ticketActivity.create({
        data: { ticketId, actorId: authorId, action: 'COMMENT_ADDED' },
      }),
    ]);

    const author = TicketsService.ticketActorName(comment.author);
    const excerpt = body.length > 80 ? `${body.slice(0, 80).trimEnd()}…` : body;
    await this.notifyTicketParticipants(
      [ticket.reporterId, ticket.assigneeId],
      authorId,
      companyId,
      {
        title: `New reply on ${ticket.ticketNumber}`,
        message: `${author}: ${excerpt}`,
        type: 'INFO',
      },
    );

    return comment;
  }

  async updateComment(companyId: number, ticketId: number, commentId: number, authorId: number, body: string) {
    await this.ensureTicketExists(companyId, ticketId);
    const comment = await this.prisma.ticketComment.findFirst({ where: { id: commentId, ticketId } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== authorId) throw new ForbiddenException('Cannot edit another user\'s comment');
    return this.prisma.ticketComment.update({
      where: { id: commentId },
      data: { body },
      include: { author: { select: EMPLOYEE_SELECT } },
    });
  }

  async deleteComment(companyId: number, ticketId: number, commentId: number, actorId: number, role?: string) {
    await this.ensureTicketExists(companyId, ticketId);
    const comment = await this.prisma.ticketComment.findFirst({ where: { id: commentId, ticketId } });
    if (!comment) throw new NotFoundException('Comment not found');
    const isAdmin = role === 'SUPERADMIN' || role === 'ADMIN';
    if (!isAdmin && comment.authorId !== actorId) throw new ForbiddenException('Cannot delete another user\'s comment');
    await this.prisma.ticketComment.delete({ where: { id: commentId } });
    return { success: true };
  }

  private async ensureTicketExists(companyId: number, ticketId: number) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, companyId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
  }

  // ─── NOTIFICATIONS ─────────────────────────────────────────────────────────

  /** Thin wrapper over the shared helper, defaulting the link to the helpdesk. */
  private async notifyTicketParticipants(
    employeeIds: (number | null | undefined)[],
    actorEmployeeId: number | null | undefined,
    companyId: number,
    payload: { title: string; message: string; type?: string; linkUrl?: string },
  ) {
    await this.notificationsService.notifyEmployees(employeeIds, {
      companyId,
      excludeEmployeeId: actorEmployeeId,
      title: payload.title,
      message: payload.message,
      type: payload.type,
      linkUrl: payload.linkUrl ?? '/crm/tickets',
    });
  }

  private static ticketActorName(actor?: { firstName?: string | null; lastName?: string | null } | null): string {
    const name = `${actor?.firstName ?? ''} ${actor?.lastName ?? ''}`.trim();
    return name || 'Someone';
  }

  // ─── ATTACHMENTS ───────────────────────────────────────────────────────────

  async addAttachment(companyId: number, ticketId: number, actorId: number, data: { fileName: string; fileUrl: string; fileSize?: number }) {
    await this.ensureTicketExists(companyId, ticketId);
    
    const [attachment] = await this.prisma.$transaction([
      this.prisma.ticketAttachment.create({
        data: {
          ticketId,
          fileName: data.fileName,
          fileUrl: data.fileUrl,
          fileSize: data.fileSize ?? null,
          uploadedById: actorId,
        }
      }),
      this.prisma.ticketActivity.create({
        data: { ticketId, actorId, action: 'ATTACHMENT_ADDED', newValue: data.fileName },
      }),
    ]);
    return attachment;
  }

  // ─── TIME TRACKING ─────────────────────────────────────────────────────────

  async startTimer(companyId: number, ticketId: number, userId: number) {
    await this.ensureTicketExists(companyId, ticketId);
    
    // Check if a timer is already running for this user and ticket
    const runningTimer = await this.prisma.ticketTimeEntry.findFirst({
      where: { ticketId, userId, endTime: null }
    });
    
    if (runningTimer) {
      throw new BadRequestException('Timer is already running for this ticket');
    }

    return this.prisma.ticketTimeEntry.create({
      data: { ticketId, userId, startTime: new Date() }
    });
  }

  async stopTimer(companyId: number, ticketId: number, userId: number, notes?: string) {
    await this.ensureTicketExists(companyId, ticketId);
    
    const runningTimer = await this.prisma.ticketTimeEntry.findFirst({
      where: { ticketId, userId, endTime: null }
    });
    
    if (!runningTimer) {
      throw new BadRequestException('No running timer found for this ticket');
    }

    const endTime = new Date();
    const duration = Math.floor((endTime.getTime() - runningTimer.startTime.getTime()) / 1000);

    return this.prisma.ticketTimeEntry.update({
      where: { id: runningTimer.id },
      data: { endTime, duration, notes }
    });
  }

  async getTimeEntries(companyId: number, ticketId: number) {
    await this.ensureTicketExists(companyId, ticketId);
    return this.prisma.ticketTimeEntry.findMany({
      where: { ticketId },
      include: { user: { select: EMPLOYEE_SELECT } },
      orderBy: { startTime: 'desc' }
    });
  }

  // ─── ANALYTICS ─────────────────────────────────────────────────────────────

  async getAnalytics(companyId: number, days = 30) {
    const windowDays = Math.min(Math.max(Number(days) || 30, 7), 365);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (windowDays - 1));

    const tickets = await this.prisma.ticket.findMany({
      where: { companyId },
      include: {
        department: { select: { name: true } },
        raisedByDepartment: { select: { id: true, name: true } },
        reporter: { select: { firstName: true, lastName: true, department: { select: { name: true } } } },
        assignee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const HOUR = 1000 * 60 * 60;
    const tally = (map: Record<string, number>, key: string) => { map[key] = (map[key] || 0) + 1; };

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};
    const byDepartment: Record<string, number> = {};
    const assigneeLoad: Record<string, number> = {};
    const resolutionByPriority: Record<string, number[]> = {};
    const resolutionHours: number[] = [];

    // Open-ticket ageing, in days since it was raised.
    const ageing = { '< 1 day': 0, '1-3 days': 0, '3-7 days': 0, '7-14 days': 0, '> 14 days': 0 };
    const OPEN_STATES = ['OPEN', 'IN_PROGRESS'];

    // Daily created/resolved series across the window.
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const created: Record<string, number> = {};
    const resolved: Record<string, number> = {};
    for (let i = 0; i < windowDays; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      created[dayKey(d)] = 0;
      resolved[dayKey(d)] = 0;
    }

    const now = Date.now();
    let unassigned = 0;
    let backlog = 0;

    for (const t of tickets) {
      tally(byStatus, t.status);
      tally(byPriority, t.priority);
      tally(byType, t.type);
      tally(byPlatform, t.platform);

      // Prefer the stored raising department; fall back to the reporter's own.
      const dept = t.raisedByDepartment?.name ?? t.reporter?.department?.name ?? 'Unassigned';
      tally(byDepartment, dept);

      if (t.assignee) {
        tally(assigneeLoad, `${t.assignee.firstName} ${t.assignee.lastName}`);
      } else {
        unassigned++;
      }

      const createdKey = dayKey(new Date(t.createdAt));
      if (createdKey in created) created[createdKey]++;

      if (t.resolvedAt) {
        const resolvedKey = dayKey(new Date(t.resolvedAt));
        if (resolvedKey in resolved) resolved[resolvedKey]++;

        const hrs = (new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()) / HOUR;
        resolutionHours.push(hrs);
        (resolutionByPriority[t.priority] ||= []).push(hrs);
      }

      if (OPEN_STATES.includes(t.status)) {
        backlog++;
        const ageDays = (now - new Date(t.createdAt).getTime()) / (HOUR * 24);
        if (ageDays < 1) ageing['< 1 day']++;
        else if (ageDays < 3) ageing['1-3 days']++;
        else if (ageDays < 7) ageing['3-7 days']++;
        else if (ageDays < 14) ageing['7-14 days']++;
        else ageing['> 14 days']++;
      }
    }

    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const median = (xs: number[]) => {
      if (!xs.length) return 0;
      const s = [...xs].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const round = (n: number) => Number(n.toFixed(1));

    // Sorted, capped leaderboards — the client renders these as-is.
    const topN = (map: Record<string, number>, n: number) =>
      Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n)
        .map(([label, value]) => ({ label, value }));

    const totalTickets = tickets.length;
    const closedCount = (byStatus['CLOSED'] ?? 0) + (byStatus['RESOLVED'] ?? 0);

    return {
      windowDays,
      kpis: {
        totalTickets,
        open: byStatus['OPEN'] ?? 0,
        inProgress: byStatus['IN_PROGRESS'] ?? 0,
        resolved: byStatus['RESOLVED'] ?? 0,
        closed: byStatus['CLOSED'] ?? 0,
        rejected: byStatus['REJECTED'] ?? 0,
        backlog,
        unassigned,
        resolvedCount: resolutionHours.length,
        avgResolutionHours: round(mean(resolutionHours)),
        medianResolutionHours: round(median(resolutionHours)),
        resolutionRate: totalTickets ? round((closedCount / totalTickets) * 100) : 0,
      },
      trend: Object.keys(created).map((d) => ({
        date: d,
        created: created[d],
        resolved: resolved[d],
      })),
      byStatus: topN(byStatus, 8),
      byPriority: topN(byPriority, 8),
      byType: topN(byType, 8),
      byPlatform: topN(byPlatform, 8),
      byDepartment: topN(byDepartment, 8),
      topAssignees: topN(assigneeLoad, 8),
      ageing: Object.entries(ageing).map(([label, value]) => ({ label, value })),
      resolutionByPriority: Object.entries(resolutionByPriority)
        .map(([label, xs]) => ({ label, value: round(mean(xs)), count: xs.length })),
    };
  }
}
