import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private prisma: PrismaService) {}

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

  // ─── CREATE ────────────────────────────────────────────────────────────────

  async create(companyId: number, reporterId: number, data: any) {
    const ticketNumber = await this.nextTicketNumber(companyId);
    const assigneeId = await this.defaultAssigneeId(companyId);
    const departmentId = await this.devDepartmentId(companyId, assigneeId);

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

    if (filters.departmentId) where.departmentId = Number(filters.departmentId);
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
    await this.ensureTicketExists(companyId, ticketId);
    const [comment] = await this.prisma.$transaction([
      this.prisma.ticketComment.create({
        data: { ticketId, authorId, body },
        include: { author: { select: EMPLOYEE_SELECT } },
      }),
      this.prisma.ticketActivity.create({
        data: { ticketId, actorId: authorId, action: 'COMMENT_ADDED' },
      }),
    ]);
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
}
