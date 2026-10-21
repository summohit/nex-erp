import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { isSuperAdmin } from '../../common/company-roles';
import { FIELD_VISIT_DAY, OPEN_VISIT_DAYS } from '../field-visit-status';
import { FieldVisitClockService } from './field-visit-clock.service';

type Viewer = { companyId: number; role: string; employeeId: number | null };

/**
 * Field visit early release (21 Oct 2026).
 *
 * The work on a visit finished early. Someone on the visit asks to be released:
 *  - DAYS: a multi-day visit ends for them after `date` (their later visit
 *    days are released, and they are back to their normal schedule);
 *  - HOURS: on `date` they may leave the site before the shift ends, and the
 *    day still counts in full — no half day, no early-leave flag.
 * The visit's project manager (lead or PROJECT_MANAGER) or the super admin
 * decides. Nobody decides their own request.
 */
@Injectable()
export class FieldVisitEarlyReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly clock: FieldVisitClockService,
  ) {}

  private todayUtc() {
    const ist = new Date(Date.now() + 330 * 60_000);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  }
  private day(v: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) throw new BadRequestException('Choose the date');
    return new Date(`${v}T00:00:00Z`);
  }
  private label(d: Date) { return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }

  /** The visit's managers: project lead and PROJECT_MANAGER members. */
  private async managersOf(requestId: number): Promise<{ projectId: number | null; ids: number[] }> {
    const r = await this.prisma.fieldVisitRequest.findUnique({
      where: { id: requestId },
      select: { project: { select: { id: true, leadId: true, members: { where: { role: 'PROJECT_MANAGER' }, select: { employeeId: true } } } } },
    });
    const p = r?.project;
    const ids = [p?.leadId, ...(p?.members ?? []).map((m) => m.employeeId)].filter((x): x is number => !!x);
    return { projectId: p?.id ?? null, ids: [...new Set(ids)] };
  }

  private async mayDecide(v: Viewer, requestId: number) {
    if (isSuperAdmin(v.role)) return true;
    if (!v.employeeId) return false;
    return (await this.managersOf(requestId)).ids.includes(v.employeeId);
  }

  /** Ask to be released early from a visit I am on. */
  async create(v: Viewer, body: { requestId: number; type: 'DAYS' | 'HOURS'; date: string; reason: string }) {
    if (!v.employeeId) throw new BadRequestException('No employee profile');
    const requestId = Number(body?.requestId);
    const type = body?.type === 'DAYS' ? 'DAYS' : body?.type === 'HOURS' ? 'HOURS' : null;
    if (!requestId || !type) throw new BadRequestException('Choose the visit and the kind of release');
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('Write what was completed and why you are asking');
    const date = this.day(body?.date);

    const visitDays = await this.prisma.fieldVisitAttendance.findMany({
      where: { requestId, employeeId: v.employeeId, companyId: v.companyId },
      select: { visitDate: true, status: true },
      orderBy: { visitDate: 'asc' },
    });
    if (!visitDays.length) throw new ForbiddenException('You are not on this field visit');
    const keys = visitDays.map((d) => d.visitDate.toISOString().slice(0, 10));
    const k = date.toISOString().slice(0, 10);
    if (!keys.includes(k)) throw new BadRequestException('That day is not one of your visit days');
    if (date < this.todayUtc()) throw new BadRequestException('Choose today or a later visit day');
    if (type === 'DAYS') {
      const later = visitDays.filter((d) => d.visitDate > date && OPEN_VISIT_DAYS.includes(d.status));
      if (!later.length) throw new BadRequestException('There are no visit days after this one to release');
    }
    const clash = await this.prisma.fieldVisitEarlyRelease.findFirst({
      where: { requestId, employeeId: v.employeeId, type, date, status: { in: ['PENDING', 'APPROVED'] } }, select: { id: true },
    });
    if (clash) throw new BadRequestException('You already asked for this');

    const row = await this.prisma.fieldVisitEarlyRelease.create({
      data: { companyId: v.companyId, requestId, employeeId: v.employeeId, type, date, reason },
    });
    const [me, visit, mgr] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: v.employeeId }, select: { firstName: true, lastName: true } }),
      this.prisma.fieldVisitRequest.findUnique({ where: { id: requestId }, select: { requestNumber: true } }),
      this.managersOf(requestId),
    ]);
    const who = `${me?.firstName ?? ''} ${me?.lastName ?? ''}`.trim();
    const what = type === 'DAYS' ? `to end visit ${visit?.requestNumber} after ${this.label(date)}` : `to leave the site early on ${this.label(date)} (${visit?.requestNumber})`;
    await this.notify(v, mgr.ids, 'Early release request', `${who} asked ${what}: ${reason}`);
    return row;
  }

  async mine(v: Viewer) {
    if (!v.employeeId) return [];
    return this.prisma.fieldVisitEarlyRelease.findMany({
      where: { employeeId: v.employeeId, companyId: v.companyId }, orderBy: { createdAt: 'desc' }, take: 30,
    });
  }

  async cancel(v: Viewer, id: number) {
    const r = await this.prisma.fieldVisitEarlyRelease.findFirst({ where: { id, companyId: v.companyId, employeeId: v.employeeId ?? -1 } });
    if (!r) throw new NotFoundException('Request not found');
    if (r.status !== 'PENDING') throw new BadRequestException('Only a pending request can be cancelled');
    return this.prisma.fieldVisitEarlyRelease.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  /** What I can decide: requests on visits of projects I manage (all, for the super admin). */
  async pending(v: Viewer) {
    const where: any = { companyId: v.companyId, status: 'PENDING' };
    if (!isSuperAdmin(v.role)) {
      if (!v.employeeId) return [];
      const projects = await this.prisma.project.findMany({
        where: { companyId: v.companyId, OR: [{ leadId: v.employeeId }, { members: { some: { employeeId: v.employeeId, role: 'PROJECT_MANAGER' } } }] },
        select: { id: true },
      });
      if (!projects.length) return [];
      const visits = await this.prisma.fieldVisitRequest.findMany({ where: { projectId: { in: projects.map((p) => p.id) } }, select: { id: true } });
      where.requestId = { in: visits.map((x) => x.id) };
      where.employeeId = { not: v.employeeId };
    }
    const rows = await this.prisma.fieldVisitEarlyRelease.findMany({ where, orderBy: { date: 'asc' } });
    if (!rows.length) return [];
    const [people, visits] = await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } },
        select: { id: true, firstName: true, lastName: true, avatarUrl: true, employeeCode: true, designation: { select: { name: true } }, department: { select: { name: true } } },
      }),
      this.prisma.fieldVisitRequest.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.requestId))] } },
        select: { id: true, requestNumber: true, location: true, startDate: true, endDate: true, project: { select: { id: true, name: true } } },
      }),
    ]);
    const pBy = new Map(people.map((p) => [p.id, p]));
    const vBy = new Map(visits.map((x) => [x.id, x]));
    return rows.map((r) => ({ ...r, employee: pBy.get(r.employeeId) ?? null, visit: vBy.get(r.requestId) ?? null }));
  }

  async canApprove(v: Viewer) {
    if (isSuperAdmin(v.role)) return { canApprove: true };
    if (!v.employeeId) return { canApprove: false };
    const n = await this.prisma.project.count({
      where: { companyId: v.companyId, OR: [{ leadId: v.employeeId }, { members: { some: { employeeId: v.employeeId, role: 'PROJECT_MANAGER' } } }] },
    });
    return { canApprove: n > 0 };
  }

  async review(v: Viewer, id: number, body: { action: 'APPROVE' | 'REJECT'; note?: string }) {
    const r = await this.prisma.fieldVisitEarlyRelease.findFirst({ where: { id, companyId: v.companyId } });
    if (!r) throw new NotFoundException('Request not found');
    if (r.status !== 'PENDING') throw new BadRequestException('This request is already decided');
    if (r.employeeId === v.employeeId) throw new ForbiddenException('You cannot decide your own request');
    if (!(await this.mayDecide(v, r.requestId))) throw new ForbiddenException("Only the project's manager or the super admin can decide this");
    const note = String(body?.note ?? '').trim() || null;
    const visit = await this.prisma.fieldVisitRequest.findUnique({ where: { id: r.requestId }, select: { requestNumber: true } });

    if (body?.action === 'REJECT') {
      if (!note) throw new BadRequestException('A rejection has to say why');
      const done = await this.prisma.fieldVisitEarlyRelease.update({
        where: { id }, data: { status: 'REJECTED', reviewedById: v.employeeId, reviewedAt: new Date(), reviewNote: note },
      });
      await this.notify(v, [r.employeeId], 'Early release rejected', `Your early release for ${visit?.requestNumber} (${this.label(r.date)}) was rejected: ${note}`);
      return done;
    }
    if (body?.action !== 'APPROVE') throw new BadRequestException('Unknown action');

    const done = await this.prisma.fieldVisitEarlyRelease.update({
      where: { id }, data: { status: 'APPROVED', reviewedById: v.employeeId, reviewedAt: new Date(), reviewNote: note },
    });

    if (r.type === 'DAYS') {
      // Later visit days are released: not expected on site any more.
      await this.prisma.fieldVisitAttendance.updateMany({
        where: { requestId: r.requestId, employeeId: r.employeeId, visitDate: { gt: r.date }, status: { in: OPEN_VISIT_DAYS } },
        data: { status: FIELD_VISIT_DAY.RELEASED },
      });
      await this.clock.completeIfNothingLeft(r.requestId);
    } else {
      // An early clock-out already made that day a half day: give it back.
      await this.prisma.attendance.updateMany({
        where: { employeeId: r.employeeId, date: r.date, clockOut: { not: null }, isEarlyLeave: true },
        data: { isEarlyLeave: false, status: 'PRESENT' },
      });
    }
    const msg = r.type === 'DAYS'
      ? `Approved: your visit ${visit?.requestNumber} ends after ${this.label(r.date)}. Later days are released.`
      : `Approved: you may leave the site early on ${this.label(r.date)}; the day counts in full.`;
    await this.notify(v, [r.employeeId], 'Early release approved', msg);
    return done;
  }

  /** Used by attendance: an approved hours release covers this day. */
  async hasApprovedHoursRelease(employeeId: number, date: Date): Promise<boolean> {
    return !!(await this.prisma.fieldVisitEarlyRelease.findFirst({
      where: { employeeId, date, type: 'HOURS', status: 'APPROVED' }, select: { id: true },
    }));
  }

  private async notify(v: Viewer, ids: (number | null | undefined)[], title: string, message: string) {
    try {
      await this.notifications.notifyEmployees(ids, { companyId: v.companyId, title, message, type: 'FIELD_VISIT', linkUrl: '/approvals', excludeEmployeeId: v.employeeId });
    } catch { /* the decision stands even if a notification fails */ }
  }
}
