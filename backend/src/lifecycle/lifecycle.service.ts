import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isHrAdmin } from '../common/company-roles';

type Viewer = { companyId: number; role: string; employeeId: number | null };

const PERSON = {
  id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true, managerId: true,
  designation: { select: { name: true } }, department: { select: { name: true } },
} as const;

const OPEN_PIP = ['ACTIVE', 'EXTENDED'];

/**
 * Probation, notice period and Performance Improvement Plans (19 Oct 2026).
 *
 * Who sees what: HR, admins and the super admin see everyone; a reporting
 * manager sees their direct reports; everyone sees their own PIP. Probation
 * is set by HR (by months or an end date). A PIP is raised by HR or the
 * person's manager, gets check-ins, and closes as Completed, Failed or
 * Cancelled, or is extended.
 */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private todayUtc(): Date {
    const ist = new Date(Date.now() + 330 * 60_000);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  }

  private daysLeft(d: Date | null | undefined): number | null {
    if (!d) return null;
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return Math.round((day - this.todayUtc().getTime()) / 86400000);
  }

  private parseDate(v: string | null | undefined, field: string): Date {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequestException(`${field} must be YYYY-MM-DD`);
    const d = new Date(`${v}T00:00:00Z`);
    if (isNaN(d.getTime())) throw new BadRequestException(`Invalid ${field}`);
    return d;
  }

  /** null = everyone (HR); otherwise the employee ids this viewer manages. */
  private async scope(v: Viewer): Promise<number[] | null> {
    if (isHrAdmin(v.role)) return null;
    if (!v.employeeId) return [];
    const reports = await this.prisma.employee.findMany({ where: { companyId: v.companyId, managerId: v.employeeId }, select: { id: true } });
    return reports.map((r) => r.id);
  }

  private async canManage(v: Viewer, employeeId: number): Promise<boolean> {
    if (isHrAdmin(v.role)) return true;
    if (!v.employeeId) return false;
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: v.companyId }, select: { managerId: true } });
    return !!e && e.managerId === v.employeeId;
  }

  private name(p: any) { return `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim(); }

  /** The three lists for the dashboard cards and the Performance tab. */
  async overview(v: Viewer) {
    const ids = await this.scope(v);
    if (ids !== null && ids.length === 0) {
      return { canManageProbation: false, isManager: false, people: [], probation: [], notice: [], pips: [] };
    }
    const inScope = ids === null ? {} : { id: { in: ids } };
    const active = { companyId: v.companyId, user: { status: { not: 'SUSPENDED' } }, offboardingStatus: { not: 'SEPARATED' } };

    const [people, onProbation, resignations, pips] = await Promise.all([
      this.prisma.employee.findMany({ where: { ...active, ...inScope }, select: { ...PERSON, joiningDate: true, employmentCategory: true }, orderBy: { firstName: 'asc' } }),
      this.prisma.employee.findMany({
        where: { ...active, ...inScope, probationEndDate: { not: null }, probationConfirmedAt: null },
        select: { ...PERSON, joiningDate: true, probationEndDate: true, employmentCategory: true },
        orderBy: { probationEndDate: 'asc' },
      }),
      this.prisma.resignation.findMany({
        where: {
          companyId: v.companyId, status: { in: ['PENDING', 'APPROVED'] },
          ...(ids === null ? {} : { employeeId: { in: ids } }),
        },
        include: { employee: { select: PERSON } },
        orderBy: { intendedLastWorkingDay: 'asc' },
      }),
      this.prisma.pip.findMany({
        where: { companyId: v.companyId, status: { in: OPEN_PIP }, ...(ids === null ? {} : { employeeId: { in: ids } }) },
        include: { employee: { select: PERSON }, raisedBy: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { checkIns: true } } },
        orderBy: { endDate: 'asc' },
      }),
    ]);

    const today = this.todayUtc().getTime();
    return {
      canManageProbation: isHrAdmin(v.role),
      isManager: ids !== null,
      people: people.map((p) => ({
        id: p.id, name: this.name(p), employeeCode: p.employeeCode, avatarUrl: p.avatarUrl,
        designation: p.designation?.name ?? null, department: p.department?.name ?? null,
        joiningDate: p.joiningDate, employmentCategory: p.employmentCategory,
      })),
      probation: onProbation.map((p) => ({
        employeeId: p.id, name: this.name(p), employeeCode: p.employeeCode, avatarUrl: p.avatarUrl,
        designation: p.designation?.name ?? null, department: p.department?.name ?? null,
        employmentCategory: p.employmentCategory, joiningDate: p.joiningDate,
        endDate: p.probationEndDate, daysLeft: this.daysLeft(p.probationEndDate),
      })),
      notice: resignations
        .map((r) => {
          const lwd = r.approvedLastWorkingDay ?? r.intendedLastWorkingDay;
          return {
            resignationId: r.id, employeeId: r.employeeId, name: this.name(r.employee), employeeCode: r.employee?.employeeCode,
            avatarUrl: r.employee?.avatarUrl, designation: r.employee?.designation?.name ?? null,
            status: r.status, appliedOn: r.createdAt, lastWorkingDay: lwd, daysLeft: this.daysLeft(lwd),
          };
        })
        // Gone a week after their last day.
        .filter((n) => !n.lastWorkingDay || n.lastWorkingDay.getTime() >= today - 7 * 86400000),
      pips: pips.map((p) => this.pipRow(p)),
    };
  }

  private pipRow(p: any) {
    return {
      id: p.id, employeeId: p.employeeId, name: this.name(p.employee), employeeCode: p.employee?.employeeCode,
      avatarUrl: p.employee?.avatarUrl, designation: p.employee?.designation?.name ?? null,
      raisedBy: p.raisedBy ? this.name(p.raisedBy) : null,
      reason: p.reason, goals: p.goals, startDate: p.startDate, endDate: p.endDate, status: p.status,
      daysLeft: this.daysLeft(p.endDate), acknowledgedAt: p.acknowledgedAt, outcomeNote: p.outcomeNote,
      closedAt: p.closedAt, checkInCount: p._count?.checkIns ?? p.checkIns?.length ?? 0,
    };
  }

  // ---------------- Probation (HR) ----------------

  /** Put on probation, or change the end date: by months from joining (or today), or a date. */
  async setProbation(v: Viewer, employeeId: number, body: { months?: number; endDate?: string }) {
    if (!isHrAdmin(v.role)) throw new ForbiddenException('Only HR and admins can set probation');
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: v.companyId }, select: { id: true, joiningDate: true } });
    if (!e) throw new NotFoundException('Employee not found');
    let end: Date;
    if (body?.endDate) {
      end = this.parseDate(body.endDate, 'endDate');
    } else {
      const months = Number(body?.months);
      if (!Number.isInteger(months) || months < 1 || months > 24) throw new BadRequestException('Months must be between 1 and 24, or give an end date');
      const base = e.joiningDate ?? this.todayUtc();
      end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()));
    }
    await this.prisma.employee.update({ where: { id: e.id }, data: { probationEndDate: end, probationConfirmedAt: null } });
    return { employeeId: e.id, endDate: end, daysLeft: this.daysLeft(end) };
  }

  /**
   * Probation passed: the person is confirmed (19 Oct 2026). Optionally made
   * permanent at the same time (employment category PERMANENT). The employee
   * and their reporting manager are told.
   */
  async confirmProbation(v: Viewer, employeeId: number, body: { makePermanent?: boolean } = {}) {
    if (!isHrAdmin(v.role)) throw new ForbiddenException('Only HR and admins can confirm probation');
    const e = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId: v.companyId, probationEndDate: { not: null } },
      select: { id: true, firstName: true, lastName: true, managerId: true, employmentCategory: true },
    });
    if (!e) throw new NotFoundException('This person is not on probation');
    const permanent = !!body?.makePermanent && e.employmentCategory !== 'PERMANENT';
    await this.prisma.employee.update({
      where: { id: e.id },
      data: { probationConfirmedAt: new Date(), ...(permanent ? { employmentCategory: 'PERMANENT' } : {}) },
    });
    const name = `${e.firstName} ${e.lastName ?? ''}`.trim();
    try {
      await this.notifications.notifyEmployees([e.id], {
        companyId: v.companyId, title: 'Probation confirmed',
        message: permanent ? 'Congratulations, your probation is complete and you are now a permanent employee.'
          : 'Congratulations, your probation is complete and you are confirmed.',
        type: 'GENERAL', linkUrl: '/employees/me/profile', excludeEmployeeId: v.employeeId,
      });
      if (e.managerId) {
        await this.notifications.notifyEmployees([e.managerId], {
          companyId: v.companyId, title: 'Probation confirmed',
          message: `${name}'s probation is confirmed${permanent ? ' and they are now permanent' : ''}.`,
          type: 'GENERAL', linkUrl: '/performance?tab=people', excludeEmployeeId: v.employeeId,
        });
      }
    } catch { /* the confirmation stands even if a notification fails */ }
    return { ok: true, madePermanent: permanent };
  }

  /** Make someone permanent without a probation (Trainee or Contract today). */
  async makePermanent(v: Viewer, employeeId: number) {
    if (!isHrAdmin(v.role)) throw new ForbiddenException('Only HR and admins can change the employment category');
    const e = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId: v.companyId }, select: { id: true, employmentCategory: true, managerId: true },
    });
    if (!e) throw new NotFoundException('Employee not found');
    if (e.employmentCategory === 'PERMANENT') throw new BadRequestException('Already permanent');
    await this.prisma.employee.update({ where: { id: e.id }, data: { employmentCategory: 'PERMANENT' } });
    try {
      await this.notifications.notifyEmployees([e.id], {
        companyId: v.companyId, title: 'You are now permanent',
        message: 'Your employment is now permanent.', type: 'GENERAL', linkUrl: '/employees/me/profile', excludeEmployeeId: v.employeeId,
      });
    } catch { /* category change stands */ }
    return { ok: true };
  }

  /** Taken off probation by mistake. */
  async clearProbation(v: Viewer, employeeId: number) {
    if (!isHrAdmin(v.role)) throw new ForbiddenException('Only HR and admins can change probation');
    await this.prisma.employee.updateMany({ where: { id: employeeId, companyId: v.companyId }, data: { probationEndDate: null, probationConfirmedAt: null } });
    return { ok: true };
  }

  // ---------------- PIP ----------------

  async createPip(v: Viewer, body: { employeeId: number; reason: string; goals: string; startDate: string; endDate: string }) {
    const employeeId = Number(body?.employeeId);
    if (!employeeId) throw new BadRequestException('Choose the employee');
    if (!(await this.canManage(v, employeeId))) throw new ForbiddenException('Only HR, admins or the reporting manager can start a PIP');
    if (employeeId === v.employeeId) throw new BadRequestException('You cannot start a PIP for yourself');
    const reason = String(body?.reason ?? '').trim();
    const goals = String(body?.goals ?? '').trim();
    if (!reason || !goals) throw new BadRequestException('Reason and goals are required');
    const start = this.parseDate(body.startDate, 'startDate');
    const end = this.parseDate(body.endDate, 'endDate');
    if (end <= start) throw new BadRequestException('End date must be after the start date');
    const open = await this.prisma.pip.findFirst({ where: { employeeId, companyId: v.companyId, status: { in: OPEN_PIP } }, select: { id: true } });
    if (open) throw new BadRequestException('This person already has an open PIP');
    const pip = await this.prisma.pip.create({
      data: { companyId: v.companyId, employeeId, raisedById: v.employeeId, reason, goals, startDate: start, endDate: end },
    });
    await this.pipNotify(v, employeeId, 'PIP started',
      (who) => `A Performance Improvement Plan has started for ${who}, ${this.d(start)} to ${this.d(end)}.`,
      `A Performance Improvement Plan has started for you, ${this.d(start)} to ${this.d(end)}. Please open it and acknowledge it.`);
    return this.getPip(v, pip.id);
  }

  private d(x: Date) { return x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }

  /**
   * Tell everyone a PIP concerns (19 Oct 2026): the employee, their reporting
   * manager, HR and the super admin — never the person who acted.
   */
  private async pipNotify(v: Viewer, employeeId: number, title: string, others: (who: string) => string, toEmployee: string) {
    try {
      const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { firstName: true, lastName: true, managerId: true } });
      const who = `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim();
      const hr = await this.prisma.employee.findMany({
        where: { companyId: v.companyId, user: { role: { in: ['HR', 'SUPERADMIN'] }, status: { not: 'SUSPENDED' } } }, select: { id: true },
      });
      const watchers = [...new Set([e?.managerId, ...hr.map((h) => h.id)].filter((x): x is number => !!x && x !== employeeId))];
      await this.notifications.notifyEmployees([employeeId], {
        companyId: v.companyId, title, message: toEmployee, type: 'PERFORMANCE', linkUrl: '/performance?tab=people', excludeEmployeeId: v.employeeId,
      });
      await this.notifications.notifyEmployees(watchers, {
        companyId: v.companyId, title, message: others(who), type: 'PERFORMANCE', linkUrl: '/performance?tab=people', excludeEmployeeId: v.employeeId,
      });
    } catch { /* the PIP change stands even if a notification fails */ }
  }

  async getPip(v: Viewer, id: number) {
    const p = await this.prisma.pip.findFirst({
      where: { id, companyId: v.companyId },
      include: {
        employee: { select: PERSON },
        raisedBy: { select: { id: true, firstName: true, lastName: true } },
        checkIns: { orderBy: { createdAt: 'desc' }, include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } } },
      },
    });
    if (!p) throw new NotFoundException('PIP not found');
    const own = p.employeeId === v.employeeId;
    if (!own && !(await this.canManage(v, p.employeeId))) throw new ForbiddenException('You cannot see this PIP');
    return {
      ...this.pipRow(p),
      canManage: !own && (await this.canManage(v, p.employeeId)),
      isMine: own,
      checkIns: p.checkIns.map((c) => ({ id: c.id, note: c.note, createdAt: c.createdAt, author: c.author ? this.name(c.author) : null, authorAvatar: c.author?.avatarUrl ?? null })),
    };
  }

  /** The signed-in person's own PIPs, open first. */
  async myPips(v: Viewer) {
    if (!v.employeeId) return [];
    const list = await this.prisma.pip.findMany({
      where: { companyId: v.companyId, employeeId: v.employeeId, status: { not: 'CANCELLED' } },
      include: { employee: { select: PERSON }, raisedBy: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { checkIns: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return list.map((p) => this.pipRow(p));
  }

  /** Closed PIPs, for history on the Performance tab. */
  async pipHistory(v: Viewer) {
    const ids = await this.scope(v);
    if (ids !== null && ids.length === 0) return [];
    const list = await this.prisma.pip.findMany({
      where: { companyId: v.companyId, status: { notIn: OPEN_PIP }, ...(ids === null ? {} : { employeeId: { in: ids } }) },
      include: { employee: { select: PERSON }, raisedBy: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { checkIns: true } } },
      orderBy: { closedAt: 'desc' },
      take: 100,
    });
    return list.map((p) => this.pipRow(p));
  }

  async addCheckIn(v: Viewer, id: number, note: string) {
    const p = await this.prisma.pip.findFirst({ where: { id, companyId: v.companyId }, select: { employeeId: true, status: true } });
    if (!p) throw new NotFoundException('PIP not found');
    if (!(await this.canManage(v, p.employeeId))) throw new ForbiddenException('Only HR, admins or the reporting manager can add a check-in');
    if (!OPEN_PIP.includes(p.status)) throw new BadRequestException('This PIP is closed');
    const text = String(note ?? '').trim();
    if (!text) throw new BadRequestException('Write the check-in note');
    await this.prisma.pipCheckIn.create({ data: { pipId: id, authorId: v.employeeId, note: text } });
    return this.getPip(v, id);
  }

  /** Extend (new end date) or close as COMPLETED, FAILED or CANCELLED. */
  async updatePip(v: Viewer, id: number, body: { action: 'EXTEND' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REVOKED'; endDate?: string; note?: string }) {
    const p = await this.prisma.pip.findFirst({ where: { id, companyId: v.companyId } });
    if (!p) throw new NotFoundException('PIP not found');
    if (!(await this.canManage(v, p.employeeId))) throw new ForbiddenException('Only HR, admins or the reporting manager can change a PIP');
    if (!OPEN_PIP.includes(p.status)) throw new BadRequestException('This PIP is already closed');
    const note = String(body?.note ?? '').trim() || null;
    if (body?.action === 'EXTEND') {
      const end = this.parseDate(body.endDate, 'endDate');
      if (end <= p.endDate) throw new BadRequestException('The new end date must be later than the current one');
      await this.prisma.pip.update({ where: { id }, data: { status: 'EXTENDED', endDate: end } });
      if (note) await this.prisma.pipCheckIn.create({ data: { pipId: id, authorId: v.employeeId, note: `Extended: ${note}` } });
      await this.pipNotify(v, p.employeeId, 'PIP extended',
        (who) => `${who}'s PIP is extended to ${this.d(end)}.`, `Your PIP is extended to ${this.d(end)}.`);
    } else if (['COMPLETED', 'FAILED', 'CANCELLED', 'REVOKED'].includes(body?.action)) {
      // REVOKED (19 Oct 2026): ended early, before its end date, with a reason.
      if (body.action !== 'CANCELLED' && !note) throw new BadRequestException(body.action === 'REVOKED' ? 'Write why it is revoked early' : 'Write the outcome');
      await this.prisma.pip.update({ where: { id }, data: { status: body.action, outcomeNote: note, closedAt: new Date() } });
      const label = ({ COMPLETED: 'completed', FAILED: 'closed as not improved', CANCELLED: 'cancelled', REVOKED: 'revoked early' } as any)[body.action];
      await this.pipNotify(v, p.employeeId, `PIP ${label}`,
        (who) => `${who}'s PIP is ${label}${note ? ': ' + note : ''}.`, `Your PIP is ${label}${note ? ': ' + note : ''}.`);
    } else {
      throw new BadRequestException('Unknown action');
    }
    return this.getPip(v, id);
  }

  /** The employee confirms they have read their PIP. */
  async acknowledge(v: Viewer, id: number) {
    const r = await this.prisma.pip.updateMany({
      where: { id, companyId: v.companyId, employeeId: v.employeeId ?? -1, acknowledgedAt: null },
      data: { acknowledgedAt: new Date() },
    });
    if (!r.count) throw new BadRequestException('Nothing to acknowledge');
    const p = await this.prisma.pip.findUnique({ where: { id }, select: { employeeId: true } });
    if (p) await this.pipNotify(v, p.employeeId, 'PIP acknowledged', (who) => `${who} has read and acknowledged their PIP.`, 'You acknowledged your PIP.');
    return this.getPip(v, id);
  }
}
