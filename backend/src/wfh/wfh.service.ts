import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isHrAdmin, isSuperAdmin } from '../common/company-roles';

type Viewer = { companyId: number; role: string; employeeId: number | null };

export const WFH_STATUS = {
  PENDING_MANAGER: 'PENDING_MANAGER',
  PENDING_HR: 'PENDING_HR',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
const OPEN = [WFH_STATUS.PENDING_MANAGER, WFH_STATUS.PENDING_HR];
const COUNTS = [...OPEN, WFH_STATUS.APPROVED];

const PERSON = {
  id: true, firstName: true, lastName: true, avatarUrl: true, employeeCode: true, managerId: true,
  designation: { select: { name: true } }, department: { select: { name: true } },
} as const;

/**
 * Work From Home requests (19 Oct 2026).
 *
 * One day per request. The reporting manager approves first, then HR. The
 * super admin may approve at any stage, which settles it; when the super admin
 * IS the reporting manager that one approval covers both steps. An HR or admin
 * manager's approval covers both steps too. Nobody approves their own request.
 * Each person may hold `wfhDaysPerMonth` pending or approved days a month.
 */
@Injectable()
export class WfhService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private todayUtc(): Date {
    const ist = new Date(Date.now() + 330 * 60_000);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  }

  private parseDay(v: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) throw new BadRequestException('Choose the date');
    const d = new Date(`${v}T00:00:00Z`);
    if (isNaN(d.getTime())) throw new BadRequestException('Invalid date');
    return d;
  }

  private label(d: Date) {
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  async getLimit(companyId: number): Promise<number> {
    const s = await this.prisma.systemSetting.findUnique({ where: { companyId }, select: { wfhDaysPerMonth: true } });
    return s?.wfhDaysPerMonth ?? 1;
  }

  async setLimit(v: Viewer, days: number) {
    if (!isHrAdmin(v.role)) throw new ForbiddenException('Only HR and admins can change the WFH limit');
    const n = Number(days);
    if (!Number.isInteger(n) || n < 0 || n > 31) throw new BadRequestException('Days per month must be 0 to 31');
    await this.prisma.systemSetting.upsert({
      where: { companyId: v.companyId },
      create: { companyId: v.companyId, wfhDaysPerMonth: n },
      update: { wfhDaysPerMonth: n },
    });
    return { wfhDaysPerMonth: n };
  }

  /** My requests, newest first, with this month's allowance. */
  async mine(v: Viewer) {
    if (!v.employeeId) return { limit: await this.getLimit(v.companyId), usedThisMonth: 0, requests: [] };
    const t = this.todayUtc();
    const [limit, requests, used] = await Promise.all([
      this.getLimit(v.companyId),
      this.prisma.wfhRequest.findMany({
        where: { employeeId: v.employeeId }, orderBy: { date: 'desc' }, take: 50,
        include: { reviewedBy: { select: { firstName: true, lastName: true } } },
      }),
      this.usedInMonth(v.employeeId, t),
    ]);
    return { limit, usedThisMonth: used, requests };
  }

  private async usedInMonth(employeeId: number, day: Date, exceptId?: number) {
    const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
    const to = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1));
    return this.prisma.wfhRequest.count({
      where: { employeeId, status: { in: COUNTS }, date: { gte: from, lt: to }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
  }

  async create(v: Viewer, body: { date: string; reason: string }) {
    if (!v.employeeId) throw new BadRequestException('No employee profile');
    const date = this.parseDay(body?.date);
    if (date < this.todayUtc()) throw new BadRequestException('WFH can be requested for today or a later day');
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('Write the reason');

    const clash = await this.prisma.wfhRequest.findFirst({
      where: { employeeId: v.employeeId, date, status: { in: COUNTS } }, select: { id: true },
    });
    if (clash) throw new BadRequestException('You already have a WFH request for this day');

    const limit = await this.getLimit(v.companyId);
    const used = await this.usedInMonth(v.employeeId, date);
    if (used >= limit) {
      const month = date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      throw new BadRequestException(
        limit === 0 ? 'WFH requests are switched off'
          : `You have used your ${limit} WFH day${limit === 1 ? '' : 's'} for ${month}`,
      );
    }

    const me = await this.prisma.employee.findUnique({ where: { id: v.employeeId }, select: { managerId: true, firstName: true, lastName: true } });
    // The super admin's own request needs nobody; no manager goes straight to HR.
    const status = isSuperAdmin(v.role) ? WFH_STATUS.APPROVED : me?.managerId ? WFH_STATUS.PENDING_MANAGER : WFH_STATUS.PENDING_HR;
    const req = await this.prisma.wfhRequest.create({
      data: { companyId: v.companyId, employeeId: v.employeeId, date, reason, status,
        ...(status === WFH_STATUS.APPROVED ? { reviewedById: v.employeeId, reviewedAt: new Date() } : {}) },
    });
    const who = `${me?.firstName ?? ''} ${me?.lastName ?? ''}`.trim();
    if (status === WFH_STATUS.PENDING_MANAGER) {
      await this.notify([me!.managerId], v, 'WFH request', `${who} asked to work from home on ${this.label(date)}: ${reason}`);
    } else if (status === WFH_STATUS.PENDING_HR) {
      await this.notify(await this.hrIds(v.companyId), v, 'WFH request', `${who} asked to work from home on ${this.label(date)}: ${reason}`);
    }
    return req;
  }

  async cancel(v: Viewer, id: number) {
    const r = await this.prisma.wfhRequest.findFirst({ where: { id, companyId: v.companyId, employeeId: v.employeeId ?? -1 } });
    if (!r) throw new NotFoundException('Request not found');
    if (![...OPEN, WFH_STATUS.APPROVED].includes(r.status as any)) throw new BadRequestException('This request is already closed');
    if (r.status === WFH_STATUS.APPROVED && r.date < this.todayUtc()) throw new BadRequestException('A past WFH day cannot be cancelled');
    return this.prisma.wfhRequest.update({ where: { id }, data: { status: WFH_STATUS.CANCELLED } });
  }

  /** What this person can decide on now. */
  async pending(v: Viewer) {
    const or: any[] = [];
    if (isSuperAdmin(v.role)) or.push({ status: { in: OPEN } });
    else {
      if (v.employeeId) or.push({ status: WFH_STATUS.PENDING_MANAGER, employee: { managerId: v.employeeId } });
      if (isHrAdmin(v.role)) or.push({ status: WFH_STATUS.PENDING_HR });
    }
    if (!or.length) return [];
    return this.prisma.wfhRequest.findMany({
      where: { companyId: v.companyId, OR: or, ...(v.employeeId ? { employeeId: { not: v.employeeId } } : {}) },
      include: { employee: { select: PERSON } },
      orderBy: { date: 'desc' },
    });
  }

  async canApprove(v: Viewer) {
    if (isSuperAdmin(v.role) || isHrAdmin(v.role)) return { canApprove: true };
    if (!v.employeeId) return { canApprove: false };
    const reports = await this.prisma.employee.count({ where: { companyId: v.companyId, managerId: v.employeeId } });
    return { canApprove: reports > 0 };
  }

  async review(v: Viewer, id: number, body: { action: 'APPROVE' | 'REJECT'; note?: string }) {
    const r = await this.prisma.wfhRequest.findFirst({
      where: { id, companyId: v.companyId }, include: { employee: { select: { id: true, managerId: true } } },
    });
    if (!r) throw new NotFoundException('Request not found');
    if (r.employeeId === v.employeeId) throw new ForbiddenException('You cannot decide your own request');
    if (!OPEN.includes(r.status as any)) throw new BadRequestException('This request is already decided');

    const superAdmin = isSuperAdmin(v.role);
    const hr = isHrAdmin(v.role);
    const isManager = !!v.employeeId && r.employee.managerId === v.employeeId;
    const mayAct = superAdmin
      || (r.status === WFH_STATUS.PENDING_MANAGER && isManager)
      || (r.status === WFH_STATUS.PENDING_HR && hr);
    if (!mayAct) {
      throw new ForbiddenException(r.status === WFH_STATUS.PENDING_MANAGER
        ? 'Waiting for the reporting manager' : 'Waiting for HR');
    }

    const note = String(body?.note ?? '').trim() || null;
    if (body?.action === 'REJECT') {
      if (!note) throw new BadRequestException('A rejection has to say why');
      const done = await this.prisma.wfhRequest.update({
        where: { id }, data: { status: WFH_STATUS.REJECTED, reviewedById: v.employeeId, reviewedAt: new Date(), reviewNote: note },
      });
      await this.notify([r.employeeId], v, 'WFH request rejected', `Your WFH request for ${this.label(r.date)} was rejected: ${note}`);
      return done;
    }
    if (body?.action !== 'APPROVE') throw new BadRequestException('Unknown action');

    // Final when the super admin approves, or when the manager is HR/admin.
    const final = superAdmin || r.status === WFH_STATUS.PENDING_HR || hr;
    const done = await this.prisma.wfhRequest.update({
      where: { id },
      data: final
        ? { status: WFH_STATUS.APPROVED, reviewedById: v.employeeId, reviewedAt: new Date(), reviewNote: note,
            ...(r.status === WFH_STATUS.PENDING_MANAGER ? { managerApprovedAt: new Date() } : {}) }
        : { status: WFH_STATUS.PENDING_HR, managerApprovedAt: new Date(), reviewNote: note },
    });
    if (final) {
      await this.notify([r.employeeId], v, 'WFH approved', `Your WFH day on ${this.label(r.date)} is approved.`);
    } else {
      await this.notify(await this.hrIds(v.companyId), v, 'WFH request', `A WFH request for ${this.label(r.date)} is approved by the manager and needs HR.`);
    }
    return done;
  }

  /** An approved WFH request covers this day (used by attendance and the roster). */
  async isApproved(employeeId: number, day: Date): Promise<boolean> {
    if (!this.prisma.wfhRequest?.findFirst) return false;
    const d = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    return !!(await this.prisma.wfhRequest.findFirst({ where: { employeeId, date: d, status: WFH_STATUS.APPROVED }, select: { id: true } }));
  }

  private async hrIds(companyId: number): Promise<number[]> {
    const rows = await this.prisma.employee.findMany({
      where: { companyId, user: { role: 'HR', status: { not: 'SUSPENDED' } } }, select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async notify(ids: (number | null | undefined)[], v: Viewer, title: string, message: string) {
    try {
      await this.notifications.notifyEmployees(ids, {
        companyId: v.companyId, title, message, type: 'ATTENDANCE', linkUrl: '/approvals', excludeEmployeeId: v.employeeId,
      });
    } catch { /* a failed notification must not undo the decision */ }
  }
}
