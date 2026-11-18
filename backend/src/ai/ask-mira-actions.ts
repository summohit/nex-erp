import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { LeavesService } from '../leaves/leaves.service';
import { TimesheetsService } from '../timesheets/timesheets.service';
import { FieldVisitRequestsService } from '../field-visits/requests/field-visit-requests.service';
import { UNQUEUED_CLOCKOUT_FROM } from '../attendance/clock-out-approval';
import { WfhService } from '../wfh/wfh.service';
import { FieldVisitEarlyReleaseService } from '../field-visits/requests/field-visit-early-release.service';
import { VisitLocationRequestsService } from '../projects/visit-location-requests/visit-location-requests.service';

/**
 * Ask MIRA actions, Version 1 (18 Nov 2026).
 *
 * The model can only PREPARE a decision: the `pending_approvals` tool lists
 * what is waiting and returns an "action" card. Nothing changes until the
 * Super Admin ticks items and presses Confirm, which calls `execute()` here.
 * Each decision goes through the same service method the normal approval
 * pages use (same rules, balances, notifications), and every item is written
 * to the audit log as coming from Ask MIRA.
 */

export const ACTION_KINDS = [
  'leave', 'regularization', 'late_clock_out', 'away_clock', 'field_visit', 'timesheet',
  // Version 2 (18 Nov 2026)
  'wfh', 'field_visit_change', 'early_release', 'visit_location',
] as const;
export type ActionKind = typeof ACTION_KINDS[number];

const KIND_LABEL: Record<ActionKind, string> = {
  leave: 'Leave requests',
  regularization: 'Regularization requests',
  late_clock_out: 'Late / forgotten clock-outs',
  away_clock: 'Away-from-office / site clocks',
  field_visit: 'Field visit requests',
  timesheet: 'Timesheet days',
  wfh: 'Work From Home requests',
  field_visit_change: 'Field visit change requests',
  early_release: 'Field visit early releases',
  visit_location: 'Visit location requests',
};

export const MAX_ITEMS = 50;
const IST = 330 * 60000;

export const ACTION_TOOL = {
  type: 'function',
  function: {
    name: 'pending_approvals',
    description:
      'Use for ANY question about approvals: what is pending/waiting, "clock out approval", "out of office approval", '
      + '"leave approval", "approve…", "reject…". Lists items waiting for approval and shows the Super Admin a Confirm card. '
      + 'It does NOT approve or reject anything — the person must press Confirm. '
      + 'Kinds: leave, regularization, late_clock_out (late / forgotten / auto clock-outs), away_clock (out of office or away from field visit site, incl. no GPS), '
      + 'field_visit, timesheet, wfh (work from home), field_visit_change (date/team change on an approved trip), '
      + 'early_release (leave the site early), visit_location (new or corrected client site / pin), or all. "Clock-out approvals" page = late_clock_out AND away_clock: call both. '
      + 'Use from/to for dates like "today" (the attendance or leave date).',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...ACTION_KINDS, 'clock_out', 'all'], description: 'clock_out = both late_clock_out and away_clock (the Clock-out Approvals page)' },
        decision: { type: 'string', enum: ['approve', 'reject'], description: 'What the user asked for; default approve' },
        employee: { type: 'string', description: 'Only this person (name)' },
        department: { type: 'string' },
        manager: { type: 'string', description: "Only this manager's direct reports (name)" },
        from: { type: 'string', description: 'YYYY-MM-DD, items dated on/after' },
        to: { type: 'string', description: 'YYYY-MM-DD, items dated on/before' },
      },
      required: ['kind'],
    },
  },
};

interface Item { id: number; employeeId: number | null; name: string; line: string; detail?: string; warn?: string }

export class AskMiraActions {
  constructor(private prisma: PrismaService, private moduleRef: ModuleRef) {}

  private svc<T>(cls: new (...a: any[]) => T): T { return this.moduleRef.get(cls as any, { strict: false }); }
  private nm(e: any) { return e ? `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() : '—'; }
  private d(x?: Date | null) { return x ? x.toISOString().slice(0, 10) : '—'; }
  private t(x?: Date | null) { return x ? new Date(x.getTime() + IST).toISOString().slice(11, 16) : '—'; }

  private empWhere(companyId: number, args: any) {
    const w: any = { companyId };
    const words = (q?: string) => String(q || '').split(/\s+/).filter(Boolean).map((x) => ({
      OR: [{ firstName: { contains: x, mode: 'insensitive' } }, { lastName: { contains: x, mode: 'insensitive' } }],
    }));
    if (args?.employee) w.AND = words(args.employee);
    if (args?.department) w.department = { name: { contains: args.department, mode: 'insensitive' } };
    if (args?.manager) w.manager = { AND: words(args.manager) };
    return w;
  }

  private range(args: any): { gte?: Date; lte?: Date } | undefined {
    const ok = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const r: any = {};
    if (ok(args?.from)) r.gte = new Date(`${args.from}T00:00:00.000Z`);
    if (ok(args?.to)) r.lte = new Date(`${args.to}T23:59:59.999Z`);
    return r.gte || r.lte ? r : undefined;
  }

  // ---------- prepare (read only) ----------
  async prepare(companyId: number, args: any) {
    const kinds: ActionKind[] = args?.kind === 'all' || !args?.kind ? [...ACTION_KINDS]
      : args.kind === 'clock_out' ? ['late_clock_out', 'away_clock']
      : [args.kind].filter((k: any) => ACTION_KINDS.includes(k));
    const decision = args?.decision === 'reject' ? 'reject' : 'approve';
    const blocks: any[] = [];
    const parts: string[] = [];
    for (const kind of kinds) {
      let items = await this.list(companyId, kind, args);
      // Nothing dated in that range: say what is still waiting overall, and show it,
      // since "today's approvals" usually means "what is waiting as of today".
      let note = '';
      if (!items.length && (args?.from || args?.to)) {
        const all = await this.list(companyId, kind, { ...args, from: undefined, to: undefined });
        if (all.length) { note = ` (none dated in that range; ${all.length} waiting overall — shown)`; items = all; }
      }
      parts.push(`${KIND_LABEL[kind]}${note}: ${items.length}${items.length ? ' — ' + items.slice(0, 12).map((i) => `${i.name} (${i.line})${i.warn ? ' [' + i.warn + ']' : ''}`).join('; ') : ''}`);
      if (items.length) {
        blocks.push({
          type: 'action', kind, decision, title: `${decision === 'approve' ? 'Approve' : 'Reject'} ${KIND_LABEL[kind].toLowerCase()}`,
          items: items.slice(0, MAX_ITEMS), total: items.length,
        });
      }
    }
    return {
      summary: `Pending (nothing has been changed; a Confirm card is shown to the user): ${parts.join(' | ')}`,
      blocks,
      source: 'Pending approval queues',
    };
  }

  private async list(companyId: number, kind: ActionKind, args: any): Promise<Item[]> {
    const employee = this.empWhere(companyId, args);
    const dr = this.range(args);
    const empSel = { select: { id: true, firstName: true, lastName: true, departmentId: true, department: { select: { name: true } } } };

    if (kind === 'leave') {
      const rows = await this.prisma.leaveRequest.findMany({
        where: { status: 'PENDING', employee, ...(dr ? { startDate: dr.lte ? { lte: dr.lte } : undefined, endDate: dr.gte ? { gte: dr.gte } : undefined } : {}) },
        orderBy: { startDate: 'asc' }, take: 200,
        include: { leaveType: { select: { name: true } }, employee: empSel },
      });
      const out: Item[] = [];
      for (const r of rows) {
        const days = r.isHalfDay ? 0.5 : Math.round((r.endDate.getTime() - r.startDate.getTime()) / 86400000) + 1;
        // Same-department people already on approved leave on any of these days.
        const clash = r.employee.departmentId ? await this.prisma.leaveRequest.count({
          where: {
            status: 'APPROVED', employeeId: { not: r.employeeId },
            employee: { departmentId: r.employee.departmentId }, startDate: { lte: r.endDate }, endDate: { gte: r.startDate },
          },
        }) : 0;
        out.push({
          id: r.id, employeeId: r.employee.id, name: this.nm(r.employee),
          line: `${r.leaveType?.name ?? 'Leave'} · ${this.d(r.startDate)}${r.endDate > r.startDate ? ' → ' + this.d(r.endDate) : ''} · ${days}d`,
          detail: r.reason || undefined,
          warn: clash ? `${clash} from ${r.employee.department?.name ?? 'the team'} already off` : undefined,
        });
      }
      return out;
    }

    if (kind === 'regularization') {
      const rows = await this.prisma.attendanceRegularization.findMany({
        where: { status: 'PENDING', employee, ...(dr ? { date: dr } : {}) }, orderBy: { date: 'asc' }, take: 200, include: { employee: empSel },
      });
      return rows.map((r) => ({
        id: r.id, employeeId: r.employee.id, name: this.nm(r.employee),
        line: `${this.d(r.date)} · in ${this.t(r.proposedClockIn)} · out ${this.t(r.proposedClockOut)}`,
        detail: r.reason || undefined,
      }));
    }

    if (kind === 'late_clock_out' || kind === 'away_clock') {
      const where: any = { employee, ...(dr ? { date: dr } : {}) };
      if (kind === 'late_clock_out') {
        // Same queue as the Clock-out Approvals page: pending, plus recent late or
        // automatic clock-outs that never entered the queue (see getPendingClockOuts).
        where.OR = [
          { clockOutApproval: 'PENDING' },
          { date: { gte: UNQUEUED_CLOCKOUT_FROM }, clockOutApproval: null, clockIn: { not: null }, clockOut: { not: null },
            OR: [{ clockOutReason: { not: null } }, { autoClockedOut: true }] },
        ];
      } else where.geofenceApproval = 'PENDING';
      const rows = await this.prisma.attendance.findMany({
        where, orderBy: { date: 'asc' }, take: 300,
        select: {
          id: true, date: true, clockIn: true, clockOut: true, clockInOutsideReason: true, clockOutOutsideReason: true,
          clockOutReason: true, clockInDistanceKm: true, employee: empSel,
        } as any,
      });
      return (rows as any[]).map((r) => ({
        id: r.id, employeeId: r.employee.id, name: this.nm(r.employee),
        line: `${this.d(r.date)} · in ${this.t(r.clockIn)} · out ${this.t(r.clockOut)}${kind === 'away_clock' && r.clockInDistanceKm != null ? ` · ${r.clockInDistanceKm} km away` : ''}`,
        detail: (kind === 'late_clock_out' ? r.clockOutReason : (r.clockInOutsideReason || r.clockOutOutsideReason)) || undefined,
      }));
    }

    if (kind === 'field_visit') {
      const rows = await this.prisma.fieldVisitRequest.findMany({
        where: { companyId, status: 'PENDING_APPROVAL', ...(dr ? { startDate: dr.lte ? { lte: dr.lte } : undefined, endDate: dr.gte ? { gte: dr.gte } : undefined } : {}), ...(args?.employee || args?.department || args?.manager ? { raisedBy: employee } : {}) },
        orderBy: { startDate: 'asc' }, take: 200,
        select: { id: true, requestNumber: true, location: true, startDate: true, endDate: true, remarks: true, raisedBy: empSel, project: { select: { name: true } }, _count: { select: { members: true } } },
      });
      return rows.map((r) => ({
        id: r.id, employeeId: r.raisedBy?.id ?? null, name: this.nm(r.raisedBy),
        line: `${r.requestNumber} · ${r.project?.name ?? '—'} · ${this.d(r.startDate)}${r.endDate > r.startDate ? ' → ' + this.d(r.endDate) : ''} · ${r._count.members} people`,
        detail: `${r.location}${r.remarks ? ' — ' + r.remarks : ''}`,
      }));
    }

    if (kind === 'wfh') {
      const rows = await this.prisma.wfhRequest.findMany({
        where: { companyId, status: { in: ['PENDING_MANAGER', 'PENDING_HR'] }, employee, ...(dr ? { date: dr } : {}) },
        orderBy: { date: 'asc' }, take: 200, include: { employee: empSel },
      });
      return rows.map((r) => ({
        id: r.id, employeeId: r.employee.id, name: this.nm(r.employee),
        line: `${this.d(r.date)} · ${r.status === 'PENDING_HR' ? 'manager approved, waiting final' : 'waiting manager'}`,
        detail: r.reason || undefined,
      }));
    }

    if (kind === 'field_visit_change') {
      const rows = await this.prisma.fieldVisitRequest.findMany({
        where: { companyId, pendingChange: { not: null as any }, ...(args?.employee || args?.department || args?.manager ? { raisedBy: employee } : {}) } as any,
        orderBy: { pendingChangeAt: 'asc' }, take: 200,
        select: { id: true, requestNumber: true, location: true, startDate: true, endDate: true, pendingChange: true, raisedBy: empSel },
      });
      return (rows as any[]).map((r) => {
        const c = r.pendingChange || {};
        const what = c.kind === 'POSTPONE' ? 'Postpone' : c.kind ? String(c.kind).toLowerCase().replace(/_/g, ' ') : 'Change';
        const to = c.startDate ? ` → ${String(c.startDate).slice(0, 10)}${c.endDate ? ' to ' + String(c.endDate).slice(0, 10) : ''}` : '';
        return {
          id: r.id, employeeId: r.raisedBy?.id ?? null, name: this.nm(r.raisedBy),
          line: `${r.requestNumber} · ${what}${to} (now ${this.d(r.startDate)} → ${this.d(r.endDate)})`,
          detail: c.reason || r.location,
        };
      });
    }

    if (kind === 'early_release') {
      // No employee relation on this model: filter and name through employee ids.
      const filtered = !!(args?.employee || args?.department || args?.manager);
      const people = await this.prisma.employee.findMany({ where: employee, select: { id: true, firstName: true, lastName: true } });
      const byId = new Map(people.map((e) => [e.id, e]));
      const rows = await this.prisma.fieldVisitEarlyRelease.findMany({
        where: { companyId, status: 'PENDING', ...(filtered ? { employeeId: { in: [...byId.keys()] } } : {}), ...(dr ? { date: dr } : {}) },
        orderBy: { date: 'asc' }, take: 200,
      });
      return rows.map((r) => ({
        id: r.id, employeeId: r.employeeId, name: this.nm(byId.get(r.employeeId)),
        line: `${this.d(r.date)} · ${r.type === 'HOURS' ? 'leave early (hours)' : String(r.type).toLowerCase()}`,
        detail: r.reason || undefined,
      }));
    }

    if (kind === 'visit_location') {
      const rows = await this.prisma.visitLocationRequest.findMany({
        where: { companyId, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 200,
      });
      const ids = [...new Set(rows.map((r) => r.requestedById))];
      const people = await this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
      const byId = new Map(people.map((e) => [e.id, e]));
      return rows.map((r) => ({
        id: r.id, employeeId: r.requestedById, name: this.nm(byId.get(r.requestedById)),
        line: `${r.name}${r.latitude != null && r.longitude != null ? ` · pin ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}` : ' · no pin'}`,
        detail: r.address || undefined,
      }));
    }

    // timesheet
    const rows = await this.prisma.timesheetDay.findMany({
      where: { companyId, status: 'SUBMITTED', employee, ...(dr ? { date: dr } : {}) }, orderBy: { date: 'asc' }, take: 200,
      select: { id: true, date: true, submittedHours: true, employee: empSel },
    });
    return rows.map((r) => ({
      id: r.id, employeeId: r.employee.id, name: this.nm(r.employee),
      line: `${this.d(r.date)} · ${Math.round((r.submittedHours || 0) * 10) / 10} h`,
    }));
  }

  // ---------- execute (after Confirm) ----------
  async execute(user: any, body: { kind: string; decision: string; ids: number[]; note?: string; question?: string }) {
    const kind = body?.kind as ActionKind;
    if (!ACTION_KINDS.includes(kind)) throw new BadRequestException('Unknown approval type');
    const decision = body?.decision === 'reject' ? 'reject' : body?.decision === 'approve' ? 'approve' : null;
    if (!decision) throw new BadRequestException('Decision must be approve or reject');
    const ids = [...new Set((body?.ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) throw new BadRequestException('Nothing selected');
    if (ids.length > MAX_ITEMS) throw new BadRequestException(`At most ${MAX_ITEMS} items at a time`);
    const note = String(body?.note ?? '').trim().slice(0, 500);
    if (decision === 'reject' && !note) throw new BadRequestException('Add a reason to reject');

    const companyId = user.companyId, role = user.role, empId = user.employeeId ?? null, userId = user.sub;
    const results: { id: number; ok: boolean; message?: string }[] = [];

    for (const id of ids) {
      try {
        await this.assertInCompany(companyId, kind, id);
        await this.decide(kind, decision, id, note, { companyId, role, empId, userId });
        results.push({ id, ok: true });
        await this.audit(companyId, userId, kind, id, decision, note, body?.question, true);
      } catch (e: any) {
        const message = e?.response?.message || e?.message || 'Failed';
        results.push({ id, ok: false, message: Array.isArray(message) ? message.join(', ') : String(message) });
        await this.audit(companyId, userId, kind, id, decision, note, body?.question, false, String(message));
      }
    }
    return { kind, decision, done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  private async assertInCompany(companyId: number, kind: ActionKind, id: number) {
    let found: any = null;
    if (kind === 'leave') found = await this.prisma.leaveRequest.findFirst({ where: { id, employee: { companyId } }, select: { id: true } });
    else if (kind === 'regularization') found = await this.prisma.attendanceRegularization.findFirst({ where: { id, employee: { companyId } }, select: { id: true } });
    else if (kind === 'late_clock_out' || kind === 'away_clock') found = await this.prisma.attendance.findFirst({ where: { id, employee: { companyId } }, select: { id: true } });
    else if (kind === 'field_visit') found = await this.prisma.fieldVisitRequest.findFirst({ where: { id, companyId }, select: { id: true } });
    else if (kind === 'field_visit_change') found = await this.prisma.fieldVisitRequest.findFirst({ where: { id, companyId }, select: { id: true } });
    else if (kind === 'wfh') found = await this.prisma.wfhRequest.findFirst({ where: { id, companyId }, select: { id: true } });
    else if (kind === 'early_release') found = await this.prisma.fieldVisitEarlyRelease.findFirst({ where: { id, companyId }, select: { id: true } });
    else if (kind === 'visit_location') found = await this.prisma.visitLocationRequest.findFirst({ where: { id, companyId }, select: { id: true } });
    else found = await this.prisma.timesheetDay.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!found) throw new ForbiddenException('Not found in your company');
  }

  private async decide(kind: ActionKind, decision: 'approve' | 'reject', id: number, note: string,
    a: { companyId: number; role: string; empId: number | null; userId: number }) {
    const ok = decision === 'approve';
    switch (kind) {
      case 'leave':
        return this.svc(LeavesService).updateRequestStatus(a.userId, id, ok ? 'APPROVED' : 'REJECTED', ok ? undefined : note);
      case 'regularization':
        return this.svc(AttendanceService).resolveRegularization(id, a.userId, ok ? 'APPROVED' : 'REJECTED', ok ? undefined : note,
          { companyId: a.companyId, role: a.role, employeeId: a.empId });
      case 'late_clock_out':
        return this.svc(AttendanceService).reviewClockOut(a.companyId, id, { action: ok ? 'APPROVE' : 'REJECT', note: note || undefined } as any, a.role, a.empId);
      case 'away_clock':
        return this.svc(AttendanceService).reviewGeofence(a.companyId, id, { action: ok ? 'APPROVE' : 'REJECT', note: note || undefined } as any, a.role, a.empId);
      case 'field_visit':
        return ok
          ? this.svc(FieldVisitRequestsService).approve(a.companyId, a.empId, a.role, id, {})
          : this.svc(FieldVisitRequestsService).reject(a.companyId, a.empId, a.role, id, note);
      case 'wfh':
        return this.svc(WfhService).review({ companyId: a.companyId, role: a.role, employeeId: a.empId } as any, id,
          { action: ok ? 'APPROVE' : 'REJECT', note: note || undefined });
      case 'early_release':
        return this.svc(FieldVisitEarlyReleaseService).review({ companyId: a.companyId, role: a.role, employeeId: a.empId } as any, id,
          { action: ok ? 'APPROVE' : 'REJECT', note: note || undefined });
      case 'field_visit_change':
        return ok
          ? this.svc(FieldVisitRequestsService).approveModification(a.companyId, a.empId, a.role, id)
          : this.svc(FieldVisitRequestsService).rejectModification(a.companyId, a.empId, a.role, id, note);
      case 'visit_location':
        return this.svc(VisitLocationRequestsService).review(a.companyId, a.empId, a.role, id, ok ? 'APPROVED' : 'REJECTED', ok ? undefined : note);
      case 'timesheet': {
        const day = await this.prisma.timesheetDay.findUnique({ where: { id }, select: { employeeId: true, date: true } });
        if (!day) throw new BadRequestException('Timesheet day not found');
        return this.svc(TimesheetsService).reviewDay(a.companyId, a.empId, a.role, day.employeeId, day.date.toISOString().slice(0, 10),
          ok ? 'APPROVED' : 'REJECTED', ok ? undefined : note);
      }
    }
  }

  private async audit(companyId: number, actorId: number, kind: string, id: number, decision: string, note: string, question: string | undefined, ok: boolean, error?: string) {
    try {
      await this.prisma.auditLog.create({
        data: {
          companyId, actorId, action: `ASK_MIRA_${decision.toUpperCase()}${ok ? '' : '_FAILED'}`, entityType: kind, entityId: String(id),
          newValue: { via: 'Ask MIRA', decision, note: note || null, question: question?.slice(0, 500) ?? null, ...(error ? { error: error.slice(0, 300) } : {}) },
        },
      });
    } catch (e: any) { console.error('Ask MIRA audit failed', e?.message); }
  }
}
