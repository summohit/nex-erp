import { isBranchWeeklyOff } from '../common/weekly-offs';
import { Injectable, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FieldVisitActivationService } from '../field-visits/requests/field-visit-activation.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { APPROVAL_WORKFLOW } from '../approvals/approval-workflows';
import { isHrAdmin, isSuperAdmin } from '../common/company-roles';

/** One employee's figures for a single leave type in the quota report. */
export interface QuotaCell {
  allocated: number;
  used: number;
  remaining: number;
  /** Of the remaining days, how many were paid out when the year closed. */
  encashed: number;
}

export interface QuotaRow {
  employee: {
    id: number;
    name: string;
    employeeCode: string | null;
    avatarUrl: string | null;
    designation: string | null;
    department: string | null;
    isActive: boolean;
  };
  byType: Record<number, QuotaCell>;
  totals: QuotaCell;
  /** No balance row exists at all — distinct from a zero balance, and fixable. */
  hasNoBalances: boolean;
}

export interface QuotaReport {
  year: number;
  leaveTypes: {
    id: number; name: string; isPaid: boolean;
    encashable: boolean; encashmentLimit: number;
  }[];
  rows: QuotaRow[];
  /** 'SELF' when the caller may only see their own figures. */
  scope: 'ALL' | 'SELF';
  /**
   * True once the year's closing payslip has bought back its unused days.
   * Until then the remaining figures are days still there to take; afterwards
   * they are days already paid for, which is a different thing to read.
   */
  encashmentSettled: boolean;
}

@Injectable()
export class LeavesService {
  private readonly logger = new Logger(LeavesService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private fieldVisits: FieldVisitActivationService,
    private approvals: ApprovalsService
  ) {}

  async assignLeaveBalance(data: { employeeId: number, leaveTypeId: number, allocated: number, year: number }) {
    return this.prisma.leaveBalance.upsert({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: data.employeeId,
          leaveTypeId: data.leaveTypeId,
          year: data.year
        }
      },
      update: {
        allocated: data.allocated
      },
      create: {
        employeeId: data.employeeId,
        leaveTypeId: data.leaveTypeId,
        allocated: data.allocated,
        year: data.year
      }
    });
  }

  async getMyBalances(userId: number, year: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee not found');
    
    return this.prisma.leaveBalance.findMany({
      where: { employeeId: employee.id, year },
      include: { leaveType: true }
    });
  }

  async getAllBalances(companyId: number, year: number, employeeId?: number) {
    return this.prisma.leaveBalance.findMany({
      where: { 
        employee: { companyId }, 
        year,
        ...(employeeId ? { employeeId } : {})
      },
      include: { 
        employee: { select: { id: true, firstName: true, lastName: true } },
        leaveType: true 
      }
    });
  }

  /**
   * The leave quota report: one row per employee, per leave type, for a year.
   *
   * Deliberately not built on getAllBalances, which returns the whole LeaveType
   * on every row — 91 employees x 13 types is 1,183 copies of the same handful
   * of type records, and this company has already been throttled once for
   * egress. The types are sent once, and each row carries ids.
   *
   * Employees with no balance row still appear, as zeros. A quota report that
   * silently omits people is worse than one that shows a gap, because the gap
   * is the thing worth acting on.
   */
  private emptyQuotaReport(year: number): QuotaReport {
    return { year, leaveTypes: [], rows: [], scope: 'SELF', encashmentSettled: false };
  }

  async getQuotaReport(
    companyId: number,
    actor: { sub: number; role?: string },
    year: number,
    employeeId?: number,
  ): Promise<QuotaReport> {
    const isAdminOrHr = ['SUPERADMIN', 'ADMIN', 'HR'].includes(actor.role ?? '');

    // Everyone else sees only themselves, whatever they ask for — the filter is
    // a convenience for admins, never the thing that enforces privacy.
    let scopeEmployeeId = employeeId;
    if (!isAdminOrHr) {
      const me = await this.prisma.employee.findUnique({
        where: { userId: actor.sub },
        select: { id: true },
      });
      if (!me) return this.emptyQuotaReport(year);
      scopeEmployeeId = me.id;
    }

    const [leaveTypes, employees, balances, encashments] = await Promise.all([
      this.prisma.leaveType.findMany({
        where: { companyId },
        select: { id: true, name: true, isPaid: true, encashable: true, encashmentLimit: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.employee.findMany({
        where: { companyId, ...(scopeEmployeeId ? { id: scopeEmployeeId } : {}) },
        select: {
          id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true,
          designation: { select: { name: true } },
          department: { select: { name: true } },
          user: { select: { status: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.leaveBalance.findMany({
        where: {
          year,
          employee: { companyId, ...(scopeEmployeeId ? { id: scopeEmployeeId } : {}) },
        },
        select: {
          employeeId: true, leaveTypeId: true,
          allocated: true, used: true,
        },
      }),
      // What the year's closing payslip actually paid out. Fetched separately
      // rather than through the balance rows, which are left untouched by
      // encashment on purpose — `used` has to keep meaning days taken.
      this.prisma.leaveEncashment.findMany({
        where: {
          year,
          employee: { companyId, ...(scopeEmployeeId ? { id: scopeEmployeeId } : {}) },
        },
        select: { employeeId: true, leaveTypeId: true, days: true },
      }),
    ]);

    const byEmployee = new Map<number, typeof balances>();
    for (const b of balances) {
      const list = byEmployee.get(b.employeeId) ?? [];
      list.push(b);
      byEmployee.set(b.employeeId, list);
    }

    const encashedDays = new Map<string, number>();
    for (const e of encashments) {
      encashedDays.set(`${e.employeeId}:${e.leaveTypeId}`, e.days);
    }

    const rows = employees.map((emp) => {
      const mine = byEmployee.get(emp.id) ?? [];
      const byType: Record<number, QuotaCell> = {};

      let allocated = 0, used = 0, encashed = 0;
      for (const type of leaveTypes) {
        const b = mine.find((x) => x.leaveTypeId === type.id);
        const a = b?.allocated ?? 0;
        const u = b?.used ?? 0;
        const e = encashedDays.get(`${emp.id}:${type.id}`) ?? 0;
        byType[type.id] = { allocated: a, used: u, remaining: a - u, encashed: e };
        allocated += a; used += u; encashed += e;
      }

      return {
        employee: {
          id: emp.id,
          name: `${emp.firstName} ${emp.lastName}`.trim(),
          employeeCode: emp.employeeCode,
          avatarUrl: emp.avatarUrl,
          designation: emp.designation?.name ?? null,
          department: emp.department?.name ?? null,
          isActive: emp.user?.status !== 'SUSPENDED',
        },
        byType,
        totals: { allocated, used, remaining: allocated - used, encashed },
        // No balance row at all is a different problem from a zero balance, and
        // it is the one somebody has to fix.
        hasNoBalances: mine.length === 0,
      };
    });

    // Deactivated staff stay visible — their history matters — but sink to the
    // bottom, matching the shift roster.
    rows.sort((a, b) => Number(a.employee.isActive === false) - Number(b.employee.isActive === false));

    return {
      year,
      leaveTypes,
      rows,
      scope: isAdminOrHr ? ('ALL' as const) : ('SELF' as const),
      encashmentSettled: encashments.length > 0,
    };
  }

  async requestLeave(userId: number, data: { leaveTypeId: number, startDate: string, endDate: string, reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string }) {
    const employee = await this.prisma.employee.findUnique({ 
      where: { userId },
      include: { user: true, branch: true, manager: { include: { user: true } } }
    });
    if (!employee) throw new BadRequestException('Employee not found');
    return this.createLeaveRequestFor(employee, data);
  }

  /**
   * The body of a leave request, once we know whose it is (§Att9).
   *
   * Split out of `requestLeave` rather than copied, because everything here —
   * the half-day rules, the overlap check, the working-day count, the field
   * visit conflicts — has to apply identically whether somebody applied for
   * themselves or an administrator did it for them. A second implementation
   * would be a second set of rules the day either one is edited.
   *
   * `onBehalf` relaxes exactly two things, and only those two. See where each
   * is used for why.
   */
  private async createLeaveRequestFor(
    employee: any,
    data: { leaveTypeId: number, startDate: string, endDate: string, reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string },
    onBehalf?: { raisedByUserId: number },
  ) {
    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);

    const isHalfDay = !!data.isHalfDay;
    if (isHalfDay) {
      const sameDay = startDate.toISOString().split('T')[0] === endDate.toISOString().split('T')[0];
      if (!sameDay) {
        throw new BadRequestException('Half-day leave is only allowed for a single day.');
      }
      const leaveType = await this.prisma.leaveType.findFirst({
        where: { id: data.leaveTypeId, companyId: employee.companyId }
      });
      if (!leaveType) throw new BadRequestException('Leave type not found');
      if (!leaveType.allowHalfDay) {
        throw new BadRequestException(`Half-day leave is not allowed for "${leaveType.name}".`);
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // An employee cannot backdate their own leave. An administrator entering it
    // for somebody else routinely must: the common case for this feature is
    // recording the week a person was off sick and unable to file anything.
    if (startDate < today && !onBehalf) {
      throw new BadRequestException('Cannot apply for leave in the past');
    }

    // Raised on behalf, the blackout has already been considered: an
    // administrator choosing this employee and these dates is making the
    // decision the blackout exists to force. Blocking them here would only
    // mean deleting the blackout to get the entry in.
    if (!onBehalf && employee.user.role !== 'SUPERADMIN' && employee.user.role !== 'ADMIN' && employee.user.role !== 'HR') {
      const blackouts = await this.prisma.blackoutDate.findMany({
        where: {
          companyId: employee.companyId,
          date: {
            gte: startDate,
            lte: endDate
          },
          OR: [
            { departmentId: null },
            { departmentId: employee.departmentId }
          ]
        }
      });
      if (blackouts.length > 0) {
        throw new BadRequestException(`Leave request overlaps with a blackout date: ${blackouts[0].date.toDateString()} - ${blackouts[0].reason}`);
      }
    }

    const potentialOverlaps = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: employee.id,
        deletedAt: null,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: endDate },
        endDate: { gte: startDate }
      }
    });

    const overlapping = potentialOverlaps.find(overlap => {
      // If either is a full day, it's a conflict
      if (!isHalfDay || !overlap.isHalfDay) return true;
      // If both are half days, they conflict only if they are the same period
      return data.halfDayPeriod === overlap.halfDayPeriod;
    });

    if (overlapping) {
      const from = new Date(overlapping.startDate).toISOString().split('T')[0];
      const to = new Date(overlapping.endDate).toISOString().split('T')[0];
      throw new BadRequestException(`Leave already applied for ${from} to ${to}`);
    }

    const workingDays = this.calculateWorkingDays(startDate, endDate, employee.branch?.weeklyOffs || '0', data.isHalfDay || false, await this.getHolidayDates(employee.companyId, startDate, endDate));
    if (workingDays === 0) {
      throw new BadRequestException('Leave duration evaluates to 0 working days.');
    }

    // §9: somebody on an approved field visit does not simply take the day.
    // The request is still allowed — refusing it outright would leave a sick
    // employee with nowhere to go — but it is flagged for the approver, who is
    // the one who can weigh a day at a client site against the reason for it.
    const fieldVisitConflicts = await this.fieldVisits.conflictsFor(
      this.prisma, employee.id, employee.companyId, startDate, endDate,
    );

    return this.prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: data.leaveTypeId,
        startDate,
        endDate,
        reason: data.reason,
        attachmentUrl: data.attachmentUrl,
        isHalfDay: data.isHalfDay || false,
        halfDayPeriod: data.halfDayPeriod || null,
        raisedById: onBehalf?.raisedByUserId ?? null
      }
    }).then(async (request) => {
      // Raised on behalf, the manager is told when it is approved a moment
      // later, by the same notification every approval sends. Telling them
      // twice about one decision they were not asked to make is noise.
      if (!onBehalf) await this.notifyManager(employee, request, fieldVisitConflicts);
      return { ...request, fieldVisitConflicts };
    });
  }

  private async notifyManager(
    employee: any, request: any,
    fieldVisitConflicts: { requestNumber: string; location: string; days: number }[] = [],
  ) {
    const name = employee.firstName && employee.lastName
      ? `${employee.firstName} ${employee.lastName}`
      : employee.user?.email || 'An employee';

    const start = new Date(request.startDate).toISOString().split('T')[0];
    const end = new Date(request.endDate).toISOString().split('T')[0];
    const dates = start === end ? start : `${start} to ${end}`;
    // The clash goes in the message itself rather than a notification of its
    // own: the approver is deciding one thing, and "they are on a field visit
    // those days" is part of that decision.
    const clash = fieldVisitConflicts.length
      ? ` They are on approved field visit${fieldVisitConflicts.length > 1 ? 's' : ''} `
        + fieldVisitConflicts
          .map((c) => `${c.requestNumber} at ${c.location} (${c.days} day${c.days === 1 ? '' : 's'})`)
          .join(', ')
        + ' — approving this takes those days off the trip.'
      : '';
    const message = `${name} has requested leave from ${dates}.${clash}`;

    // Track notified user IDs to avoid duplicates
    const notifiedUserIds = new Set<number>();

    // 1. Notify the Reporting Manager (if assigned)
    const manager = employee.manager;
    if (manager?.user && manager.user.id !== employee.userId) {
      notifiedUserIds.add(manager.user.id);
      await this.notificationsService.createNotification(
        manager.user.id,
        'New Leave Request',
        message,
        'LEAVE',
        '/attendance/leave-approvals',
        employee.companyId
      );
    }

    // 2. Notify all SUPERADMIN and HR users in the same company (excluding the requester)
    const adminHrUsers = await this.prisma.user.findMany({
      where: {
        companyId: employee.companyId,
        role: { in: ['SUPERADMIN', 'HR'] },
        id: { not: employee.userId },
        status: 'ACTIVE'
      },
      select: { id: true }
    });

    for (const adminUser of adminHrUsers) {
      if (!notifiedUserIds.has(adminUser.id)) {
        notifiedUserIds.add(adminUser.id);
        await this.notificationsService.createNotification(
          adminUser.id,
          'New Leave Request',
          message,
          'LEAVE',
          '/attendance/leave-approvals',
          employee.companyId
        );
      }
    }
  }

  async getRequests(companyId: number, filter: any) {
    return this.prisma.leaveRequest.findMany({
      // §Att10: a deleted request is gone for every reader. Soft deletion that
      // leaks into one list is worse than none — it tells the Super Admin the
      // record is gone while everybody else keeps seeing it.
      where: { employee: { companyId }, deletedAt: null },
      include: {
        employee: { 
          select: { 
            id: true, 
            firstName: true, 
            lastName: true, 
            avatarUrl: true,
            employeeCode: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            user: { select: { email: true, role: true } }
          } 
        },
        leaveType: true,
        approvedBy: { select: { email: true, employee: { select: { firstName: true, lastName: true } } } }
      },
      // Most recent leave date first, so today's leaves head the list.
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
    });
  }

  async getPendingApprovalsForCompany(companyId: number, take: number = 8) {
    return this.prisma.leaveRequest.findMany({
      where: { employee: { companyId }, status: 'PENDING', deletedAt: null },
      include: {
        employee: { 
          select: { 
            id: true, 
            firstName: true, 
            lastName: true, 
            avatarUrl: true,
            employeeCode: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            user: { select: { email: true, role: true } }
          } 
        },
        leaveType: true,
        approvedBy: { select: { email: true, employee: { select: { firstName: true, lastName: true } } } }
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      take
    });
  }

  async getManagerRequests(userId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true }
    });
    if (!employee) throw new BadRequestException('Employee not found');

    const descendantIds = await this.getDescendantEmployeeIds(employee.id);
    if (descendantIds.length === 0) return [];

    return this.prisma.leaveRequest.findMany({
      where: { employeeId: { in: descendantIds }, status: 'PENDING', deletedAt: null },
      include: {
        employee: { 
          select: { 
            id: true, 
            firstName: true, 
            lastName: true, 
            avatarUrl: true,
            employeeCode: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            user: { select: { email: true, role: true } }
          } 
        },
        leaveType: true,
        approvedBy: { select: { email: true, employee: { select: { firstName: true, lastName: true } } } }
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
    });
  }

  private async isEmployeeInHierarchy(managerEmployeeId: number, targetEmployeeId: number): Promise<boolean> {
    let currentId: number | null = targetEmployeeId;
    while (currentId !== null) {
      if (currentId === managerEmployeeId) return true;
      const emp = await this.prisma.employee.findUnique({
        where: { id: currentId },
        select: { managerId: true }
      });
      currentId = emp?.managerId ?? null;
    }
    return false;
  }

  private async getDescendantEmployeeIds(employeeId: number): Promise<number[]> {
    const result: number[] = [];
    const queue = [employeeId];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const children = await this.prisma.employee.findMany({
        where: { managerId: parentId },
        select: { id: true }
      });
      for (const child of children) {
        result.push(child.id);
        queue.push(child.id);
      }
    }
    return result;
  }

  async updateRequest(userId: number, requestId: number, data: { startDate?: string, endDate?: string, reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string }) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee not found');

    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, employeeId: employee.id, deletedAt: null }
    });

    if (!request) throw new BadRequestException('Request not found or not authorized');
    if (request.status !== 'PENDING') throw new BadRequestException('Only pending requests can be edited');

    const updateData: any = {};
    if (data.startDate) updateData.startDate = new Date(data.startDate);
    if (data.endDate) updateData.endDate = new Date(data.endDate);
    if (data.reason !== undefined) updateData.reason = data.reason;
    if (data.attachmentUrl !== undefined) updateData.attachmentUrl = data.attachmentUrl;
    if (data.isHalfDay !== undefined) updateData.isHalfDay = data.isHalfDay;
    if (data.halfDayPeriod !== undefined) updateData.halfDayPeriod = data.halfDayPeriod;

    const newIsHalfDay = data.isHalfDay !== undefined ? data.isHalfDay : request.isHalfDay;
    const newStart = updateData.startDate || request.startDate;
    const newEnd = updateData.endDate || request.endDate;
    if (newIsHalfDay) {
      const sameDay = new Date(newStart).toISOString().split('T')[0] === new Date(newEnd).toISOString().split('T')[0];
      if (!sameDay) {
        throw new BadRequestException('Half-day leave is only allowed for a single day.');
      }
      const leaveType = await this.prisma.leaveType.findFirst({
        where: { id: request.leaveTypeId, companyId: employee.companyId }
      });
      if (leaveType && !leaveType.allowHalfDay) {
        throw new BadRequestException(`Half-day leave is not allowed for "${leaveType.name}".`);
      }
    }

    const potentialOverlaps = await this.prisma.leaveRequest.findMany({
      where: {
        id: { not: requestId },
        employeeId: employee.id,
        deletedAt: null,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: newEnd },
        endDate: { gte: newStart }
      }
    });

    const overlapping = potentialOverlaps.find(overlap => {
      if (!newIsHalfDay || !overlap.isHalfDay) return true;
      const newPeriod = updateData.halfDayPeriod !== undefined ? updateData.halfDayPeriod : request.halfDayPeriod;
      return newPeriod === overlap.halfDayPeriod;
    });

    if (overlapping) {
      const from = new Date(overlapping.startDate).toISOString().split('T')[0];
      const to = new Date(overlapping.endDate).toISOString().split('T')[0];
      throw new BadRequestException(`Leave already applied for ${from} to ${to}`);
    }

    return this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: updateData
    });
  }

  async cancelRequest(userId: number, requestId: number) {
    const employee = await this.prisma.employee.findUnique({ 
      where: { userId },
      include: { branch: true }
    });
    if (!employee) throw new BadRequestException('Employee not found');

    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, employeeId: employee.id, deletedAt: null }
    });

    if (!request) throw new BadRequestException('Request not found or not authorized');
    if (request.status === 'REJECTED' || request.status === 'CANCELLED') {
      throw new BadRequestException('Request is already ' + request.status.toLowerCase());
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.leaveRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED' }
      });

      if (request.status === 'APPROVED') {
        const start = new Date(request.startDate);
        const end = new Date(request.endDate);
        const diffDays = this.calculateWorkingDays(start, end, employee.branch?.weeklyOffs || '0', request.isHalfDay, await this.getHolidayDates(employee.companyId, start, end));
        
        await tx.leaveBalance.updateMany({
          where: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year: start.getFullYear()
          },
          data: {
            used: { decrement: diffDays }
          }
        });

        // §Att10: the days are theirs to work again, so the roster has to stop
        // describing them as somebody else's. This gives back the standing
        // shift; it deliberately does not put them back on a client visit the
        // leave took them off — see restoreStandingShiftAfterLeave.
        await this.fieldVisits.restoreStandingShiftAfterLeave(tx, {
          employeeId: request.employeeId,
          companyId: employee.companyId,
          from: start,
          to: end,
        });
      }

      return updatedRequest;
    });
  }

  /**
   * May this person raise or remove leave for somebody else (§Att9/§Att10)?
   *
   * Super Admin and HR always may — that is the company's own structure, not
   * the Super Admin's to revoke — plus anyone put on the LEAVE_ON_BEHALF
   * queue. The same shape as the clock-out rule, and for the same reason: the
   * answer is partly a role and partly a list, so it cannot live in a
   * decorator.
   */
  async mayActOnBehalf(
    companyId: number, role?: string | null, employeeId?: number | null,
  ): Promise<boolean> {
    if (isHrAdmin(role)) return true;
    return this.approvals.mayApprove(
      companyId, APPROVAL_WORKFLOW.LEAVE_ON_BEHALF, role, employeeId,
    );
  }

  /**
   * Apply leave for somebody else (§Att9).
   *
   * Approved on creation rather than raised as pending. The people who may do
   * this are already the people who approve leave, so routing it back for them
   * to approve their own entry decides nothing — it only leaves a request
   * sitting in a queue looking like it needs attention.
   *
   * The approval itself goes through `updateRequestStatus`, unchanged: that is
   * where the balance is deducted, field visit days are released and the
   * employee is notified. Re-implementing any of it here would be a second
   * definition of what approving leave means.
   */
  async requestLeaveOnBehalf(
    actorUserId: number,
    data: {
      employeeId: number, leaveTypeId: number, startDate: string, endDate: string,
      reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string,
    },
  ) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, role: true, employee: { select: { id: true, companyId: true } } },
    });
    if (!actor) throw new BadRequestException('User not found');

    const companyId = actor.employee?.companyId;
    if (companyId == null) throw new BadRequestException('Your account is not linked to an employee record');

    if (!(await this.mayActOnBehalf(companyId, actor.role, actor.employee?.id ?? null))) {
      throw new ForbiddenException(
        'You are not allowed to apply leave for other people. A Super Admin can add you to this list.',
      );
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: data.employeeId, companyId },
      include: { user: true, branch: true, manager: { include: { user: true } } },
    });
    if (!employee) throw new BadRequestException('Employee not found');

    const created = await this.createLeaveRequestFor(employee, data, {
      raisedByUserId: actorUserId,
    });

    // Approved through the ordinary path, so the balance, the field visits and
    // the employee's notification all happen exactly as they always do.
    const approved = await this.updateRequestStatus(actorUserId, created.id, 'APPROVED');
    return { ...approved, fieldVisitConflicts: created.fieldVisitConflicts };
  }

  /**
   * Remove a leave request (§Att10).
   *
   * A soft delete. It is gone for every reader — every query in this service
   * filters `deletedAt: null` — but the row survives, because leave history is
   * the evidence behind somebody's pay and a mis-click should not be able to
   * destroy a year-old approved absence.
   *
   * An approved request gives its days back on the way out, in the same write.
   * Removing the record while leaving the balance spent would take leave from
   * somebody twice, and the second time invisibly.
   */
  async deleteRequest(actorUserId: number, requestId: number) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, role: true, employee: { select: { id: true, companyId: true } } },
    });
    if (!actor) throw new BadRequestException('User not found');
    if (!isSuperAdmin(actor.role)) {
      throw new ForbiddenException('Only a Super Admin can delete a leave request.');
    }

    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, deletedAt: null, employee: { companyId: actor.employee?.companyId } },
      include: { employee: { include: { branch: true } } },
    });
    if (!request) throw new BadRequestException('Request not found');

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.leaveRequest.update({
        where: { id: requestId },
        data: { deletedAt: new Date(), deletedById: actorUserId },
      });

      if (request.status === 'APPROVED') {
        const start = new Date(request.startDate);
        const end = new Date(request.endDate);
        const days = this.calculateWorkingDays(
          start, end, request.employee.branch?.weeklyOffs || '0', request.isHalfDay,
          await this.getHolidayDates(request.employee.companyId, start, end),
        );
        await tx.leaveBalance.updateMany({
          where: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year: start.getFullYear(),
          },
          data: { used: { decrement: days } },
        });

        // §Att10: same as cancelling. A deleted leave has to leave the roster
        // in the same state a cancelled one does, or the two ways of undoing
        // leave would disagree about where somebody is expected to be.
        await this.fieldVisits.restoreStandingShiftAfterLeave(tx, {
          employeeId: request.employeeId,
          companyId: request.employee.companyId,
          from: start,
          to: end,
        });
      }

      return { deleted: true, id: deleted.id };
    });
  }

  async getMyRequests(userId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee not found');

    return this.prisma.leaveRequest.findMany({
      where: { employeeId: employee.id, deletedAt: null },
      include: {
        leaveType: true,
        // The detail view identifies whose leave it is. Without this it fell
        // back to "You" and a placeholder initial — accurate, but useless on a
        // printed or forwarded record.
        //
        // An explicit select, not `employee: true`: that relation carries bank
        // details, salary-adjacent fields and identification numbers, none of
        // which belong in a leave list.
        employee: {
          select: {
            id: true, firstName: true, lastName: true, avatarUrl: true, employeeCode: true,
            designation: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        approvedBy: { select: { email: true, employee: { select: { firstName: true, lastName: true } } } }
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
    });
  }

  async updateRequestStatus(userId: number, requestId: number, status: string, rejectionReason?: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, employee: { select: { id: true } } }
    });
    if (!actor) throw new BadRequestException('User not found');

    // findFirst rather than findUnique: a deleted request must not be
    // approvable, and findUnique cannot filter on anything but the key.
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, deletedAt: null },
      include: { employee: { include: { branch: true } } }
    });

    if (!request) throw new BadRequestException('Request not found');
    if (status === 'REJECTED' && !rejectionReason) throw new BadRequestException('Rejection reason is required');

    const isAdminOrHr = ['SUPERADMIN', 'ADMIN', 'HR'].includes(actor.role);
    const isInHierarchy = actor.employee?.id
      ? await this.isEmployeeInHierarchy(actor.employee.id, request.employeeId)
      : false;
    if (!isAdminOrHr && !isInHierarchy) {
      throw new BadRequestException('Not authorized to update this leave request');
    }

    // Filled inside the transaction, acted on once it commits.
    let released: {
      requestId: number; requestNumber: string; raisedById: number;
      days: number; archivedTasks: number;
    }[] = [];

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.leaveRequest.update({
        where: { id: requestId },
        data: {
          status,
          rejectionReason: status === 'REJECTED' ? rejectionReason : null,
          approvedById: userId
        }
      });

      if (status === 'APPROVED' && request.status !== 'APPROVED') {
        const start = new Date(request.startDate);
        const end = new Date(request.endDate);
        const diffDays = this.calculateWorkingDays(start, end, request.employee.branch?.weeklyOffs || '0', request.isHalfDay, await this.getHolidayDates(request.employee.companyId, start, end));
        
        await tx.leaveBalance.updateMany({
          where: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year: start.getFullYear()
          },
          data: {
            used: { increment: diffDays }
          }
        });

        // §9: the trip gives back the days this leave covers, in the same
        // write that grants it. Leave approved while the person is still
        // rostered at a client site is the state where the two systems
        // disagree about where somebody is supposed to be.
        released = await this.fieldVisits.releaseDaysForLeave(tx, {
          employeeId: request.employeeId,
          companyId: request.employee.companyId,
          from: start,
          to: end,
          isHalfDay: request.isHalfDay,
          actorId: actor.employee?.id ?? null,
        });
      } else if (status === 'REJECTED' && request.status === 'APPROVED') {
        const start = new Date(request.startDate);
        const end = new Date(request.endDate);
        const diffDays = this.calculateWorkingDays(start, end, request.employee.branch?.weeklyOffs || '0', request.isHalfDay, await this.getHolidayDates(request.employee.companyId, start, end));
        
        await tx.leaveBalance.updateMany({
          where: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year: start.getFullYear()
          },
          data: {
            used: { decrement: diffDays }
          }
        });
      }

      const requester = await tx.employee.findUnique({
        where: { id: request.employeeId },
        include: { user: true }
      });
      if (requester?.user) {
        const start = new Date(request.startDate).toISOString().split('T')[0];
        const end = new Date(request.endDate).toISOString().split('T')[0];
        const dates = start === end ? start : `${start} to ${end}`;
        const statusLabel = status === 'APPROVED' ? 'approved' : 'rejected';
        await this.notificationsService.createNotification(
          requester.user.id,
          `Leave Request ${status}`,
          `Your leave request (${dates}) has been ${statusLabel}.`,
          'LEAVE',
          '/attendance-leave',
          requester.companyId
        );
      }

      return updatedRequest;
    });

    // The project manager finds out that somebody they are counting on is not
    // coming. After the commit, never inside it: a notification for days that
    // were then rolled back would point at a trip nobody had left.
    for (const trip of released.filter((t) => t.days > 0)) {
      const who = `${request.employee.firstName ?? ''} ${request.employee.lastName ?? ''}`.trim()
        || 'An employee';
      await this.notificationsService.notifyEmployees([trip.raisedById], {
        companyId: request.employee.companyId,
        title: 'Field visit: someone is on leave',
        message: `${who} has approved leave covering ${trip.days} day(s) of ${trip.requestNumber}.`
          + `${trip.archivedTasks ? ` Their ${trip.archivedTasks} task(s) on it were archived.` : ''}`,
        type: 'WARNING',
        linkUrl: '/field-visits/requests',
      });
    }

    return updated;
  }

  /**
   * Working days between two dates, inclusive, for this branch.
   *
   * Weekly offs go through the same rule attendance and the roster use, so
   * "6:even" means only the 2nd and 4th Saturdays — not every Saturday, which
   * is how a leave on a working 1st Saturday came out as zero days. Days are
   * walked by calendar date in UTC, the way leave dates and holidays are
   * stored, so the server's own timezone cannot shift a day.
   */
  private calculateWorkingDays(start: Date, end: Date, weeklyOffsStr: string, isHalfDay: boolean, holidayDates?: Set<string>): number {
    const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const current = dayOf(start);
    const last = dayOf(end);

    let count = 0;
    while (current <= last) {
      const dateStr = current.toISOString().split('T')[0];
      if (!isBranchWeeklyOff(current, weeklyOffsStr) && !(holidayDates && holidayDates.has(dateStr))) {
        count++;
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return isHalfDay ? (count > 0 ? 0.5 : 0) : count;
  }

  private async getHolidayDates(companyId: number, start: Date, end: Date): Promise<Set<string>> {
    const holidays = await this.prisma.holiday.findMany({
      where: {
        companyId,
        date: { gte: start, lte: end }
      },
      select: { date: true }
    });
    const set = new Set<string>();
    holidays.forEach(h => set.add(h.date.toISOString().split('T')[0]));
    return set;
  }
}
