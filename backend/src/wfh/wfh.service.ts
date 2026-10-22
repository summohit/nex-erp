import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isHrAdmin, isSuperAdmin } from '../common/company-roles';
import { isBranchWeeklyOff, personalDaysOff } from '../common/weekly-offs';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
    const thisMonth = requests.filter((r) => r.date.getUTCFullYear() === t.getUTCFullYear() && r.date.getUTCMonth() === t.getUTCMonth());
    const counts = {
      approved: thisMonth.filter((r) => r.status === WFH_STATUS.APPROVED).length,
      pending: thisMonth.filter((r) => OPEN.includes(r.status as any)).length,
      rejected: thisMonth.filter((r) => r.status === WFH_STATUS.REJECTED).length,
      assigned: thisMonth.filter((r) => r.source === 'ASSIGNED' && r.status === WFH_STATUS.APPROVED).length,
    };
    return { limit, usedThisMonth: used, requests, counts };
  }

  /**
   * HR / super admin assign WFH from the roster (21 Oct 2026): approved at
   * once, no approval steps, and outside the employee's monthly allowance.
   * Days the person already has WFH for are skipped. Each person is told.
   */
  async assign(v: Viewer, body: { employeeIds: number[]; dates: string[]; reason?: string }) {
    if (!isHrAdmin(v.role)) throw new ForbiddenException('Only HR and admins can assign WFH');
    const ids = [...new Set((body?.employeeIds ?? []).map(Number).filter(Boolean))];
    const dates = [...new Set((body?.dates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].map((d) => this.parseDay(d));
    if (!ids.length) throw new BadRequestException('Choose at least one employee');
    if (!dates.length) throw new BadRequestException('Choose at least one day');
    if (ids.length * dates.length > 500) throw new BadRequestException('Too many days at once (max 500)');
    const people = await this.prisma.employee.findMany({
      where: { id: { in: ids }, companyId: v.companyId },
      select: { id: true, weeklyOffs: true, shift: { select: { workingDays: true } }, branch: { select: { weeklyOffs: true } } },
    });
    const valid = new Set(people.map((p) => p.id));
    // Each person's own days off are skipped (21 Oct 2026): the roster's day
    // off, else the shift's working days, else the branch weekly off — the
    // same order the roster uses. Not a blanket weekend rule.
    const roster = await this.prisma.shiftRosterEntry.findMany({
      where: { employeeId: { in: [...valid] }, date: { in: dates } }, select: { employeeId: true, date: true, isDayOff: true },
    });
    const rosterBy = new Map(roster.map((r) => [`${r.employeeId}_${r.date.toISOString().slice(0, 10)}`, r.isDayOff]));
    const isOff = (p: (typeof people)[number], d: Date) => {
      const k = `${p.id}_${d.toISOString().slice(0, 10)}`;
      if (rosterBy.has(k)) return !!rosterBy.get(k);
      const own = personalDaysOff(p);
      const wd = own.shiftWorkingDays?.trim();
      if (wd) return !wd.split(',').map((x) => x.trim()).includes(DAY_NAMES[d.getUTCDay()]);
      return isBranchWeeklyOff(d, own.weeklyOffs);
    };
    const existing = await this.prisma.wfhRequest.findMany({
      where: { employeeId: { in: [...valid] }, date: { in: dates }, status: { in: COUNTS } }, select: { employeeId: true, date: true },
    });
    const have = new Set(existing.map((e) => `${e.employeeId}_${e.date.toISOString().slice(0, 10)}`));
    const reason = String(body?.reason ?? '').trim() || 'Assigned by HR';
    const rows: any[] = [];
    let daysOff = 0;
    for (const p of people) for (const d of dates) {
      const id = p.id;
      if (isOff(p, d)) { daysOff++; continue; }
      if (have.has(`${id}_${d.toISOString().slice(0, 10)}`)) continue;
      rows.push({ companyId: v.companyId, employeeId: id, date: d, reason, status: WFH_STATUS.APPROVED, source: 'ASSIGNED', reviewedById: v.employeeId, reviewedAt: new Date() });
    }
    if (rows.length) await this.prisma.wfhRequest.createMany({ data: rows });
    const label = dates.length === 1 ? this.label(dates[0]) : `${dates.length} days from ${this.label(dates.sort((a, b) => a.getTime() - b.getTime())[0])}`;
    await this.notify([...valid], v, 'WFH assigned', `You are set to work from home: ${label}. ${reason}`);
    return { created: rows.length, skipped: valid.size * dates.length - rows.length - daysOff, daysOff };
  }

  /**
   * WFH report for HR (21 Oct 2026): everyone's WFH in a month, per person
   * (approved, pending, rejected, assigned) and every day, optionally one department.
   */
  async report(v: Viewer, q: { month?: number; year?: number; departmentId?: number }) {
    if (!isHrAdmin(v.role)) throw new ForbiddenException('Only HR and admins can see the WFH report');
    const now = new Date(Date.now() + 330 * 60_000);
    const y = Number(q.year) || now.getUTCFullYear();
    const m = Number(q.month) || now.getUTCMonth() + 1;
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const rows = await this.prisma.wfhRequest.findMany({
      where: {
        companyId: v.companyId, date: { gte: from, lt: to }, status: { not: WFH_STATUS.CANCELLED },
        ...(q.departmentId ? { employee: { departmentId: Number(q.departmentId) } } : {}),
      },
      include: { employee: { select: PERSON }, reviewedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { date: 'asc' },
    });
    const byPerson = new Map<number, any>();
    for (const r of rows) {
      const p = byPerson.get(r.employeeId) ?? {
        employee: r.employee, approved: 0, pending: 0, rejected: 0, assigned: 0, days: [] as any[],
      };
      if (r.status === WFH_STATUS.APPROVED) p.approved++;
      else if (OPEN.includes(r.status as any)) p.pending++;
      else if (r.status === WFH_STATUS.REJECTED) p.rejected++;
      if (r.source === 'ASSIGNED' && r.status === WFH_STATUS.APPROVED) p.assigned++;
      p.days.push({ id: r.id, date: r.date, status: r.status, source: r.source, reason: r.reason, reviewNote: r.reviewNote });
      byPerson.set(r.employeeId, p);
    }
    const people = [...byPerson.values()].sort((a, b) => b.approved + b.pending - (a.approved + a.pending));
    return {
      month: m, year: y, limit: await this.getLimit(v.companyId),
      totals: {
        approved: people.reduce((n, p) => n + p.approved, 0),
        pending: people.reduce((n, p) => n + p.pending, 0),
        rejected: people.reduce((n, p) => n + p.rejected, 0),
        assigned: people.reduce((n, p) => n + p.assigned, 0),
        people: people.length,
      },
      people,
    };
  }

  /** HR / super admin cancel any WFH day, e.g. one assigned by mistake. */
  async adminCancel(v: Viewer, id: number) {
    if (!isHrAdmin(v.role)) throw new ForbiddenException('Only HR and admins can cancel this');
    const r = await this.prisma.wfhRequest.findFirst({ where: { id, companyId: v.companyId } });
    if (!r) throw new NotFoundException('Request not found');
    if (![...OPEN, WFH_STATUS.APPROVED].includes(r.status as any)) throw new BadRequestException('This request is already closed');
    const done = await this.prisma.wfhRequest.update({ where: { id }, data: { status: WFH_STATUS.CANCELLED } });
    await this.notify([r.employeeId], v, 'WFH cancelled', `Your WFH day on ${this.label(r.date)} was cancelled by HR.`);
    return done;
  }

  private async usedInMonth(employeeId: number, day: Date, exceptId?: number) {
    const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
    const to = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1));
    return this.prisma.wfhRequest.count({
      // Days HR assigned from the roster are not the employee's allowance.
      where: { employeeId, source: 'REQUEST', status: { in: COUNTS }, date: { gte: from, lt: to }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
  }

  async create(v: Viewer, body: { date: string; reason: string }) {
    throw new ForbiddenException(
      'Work From Home self-requests have been disabled. Work From Home can only be assigned directly by HR and Superadmin via the Shift Roster.'
    );
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
