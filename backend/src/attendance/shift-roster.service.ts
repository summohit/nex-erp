import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface RosterQuery {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  departmentId?: number;
  employeeId?: number;
}

export interface RosterAssignment {
  employeeId: number;
  date: string; // YYYY-MM-DD
  shiftId?: number | null;
  isDayOff?: boolean;
  note?: string;
  /** On-site shift details */
  projectId?: number | null;
  address?: string | null;
  /** True when the requester chose "No Project" — routes the row to Admin + HR. */
  needsApproval?: boolean;
  /** Clock window for this assignment, "HH:mm" IST. Null/absent = use the shift's. */
  startTime?: string | null;
  endTime?: string | null;
}

/**
 * Which shift actually governs one person on one day, once the roster has had
 * its say. `startTime`/`endTime` are already merged: a roster entry's own
 * window wins over the shift's, and the shift's is the fallback.
 */
export interface EffectiveShift {
  source: 'ROSTER' | 'STANDING' | 'NONE';
  shift: { id: number; name: string; bufferTimeMinutes: number } | null;
  startTime: string | null;
  endTime: string | null;
  isDayOff: boolean;
  /** Non-null only for an on-site day that is actually in force. */
  onsite: { projectId: number | null; address: string | null } | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Midnight UTC for a YYYY-MM-DD key — matches how @db.Date round-trips. */
function dateKey(s: string): Date {
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${s}`);
  return d;
}

function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class ShiftRosterService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /**
   * The roster grid: one row per employee, one cell per day in the range.
   *
   * A cell resolves in priority order — an approved leave hides whatever was
   * rostered, then an explicit roster entry, then the employee's standing shift
   * (shown as a faint default), and a day the shift doesn't operate is a day off.
   */
  async getGrid(companyId: number, q: RosterQuery) {
    const start = dateKey(q.start);
    const end = dateKey(q.end);
    if (end < start) throw new BadRequestException('end must not be before start');

    const days: string[] = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(toKey(d));
    }
    if (days.length > 62) throw new BadRequestException('Range is limited to 62 days');

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.employeeId ? { id: q.employeeId } : {}),
      },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true,
        department: { select: { id: true, name: true } },
        designation: { select: { name: true } },
        shift: true,
        user: { select: { status: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    // Deactivated staff stay visible — their history matters — but sink to the
    // bottom so the roster reads as the current team first.
    employees.sort((a, b) => {
      const ia = a.user?.status === 'SUSPENDED' ? 1 : 0;
      const ib = b.user?.status === 'SUSPENDED' ? 1 : 0;
      return ia - ib;
    });
    const empIds = employees.map(e => e.id);
    if (!empIds.length) return { days, shifts: [], rows: [] };

    const [entries, leaves, shifts] = await Promise.all([
      this.prisma.shiftRosterEntry.findMany({
        where: { companyId, employeeId: { in: empIds }, date: { gte: start, lte: end } },
        include: { shift: true, project: { select: { id: true, name: true, address: true } } },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          employeeId: { in: empIds },
          status: 'APPROVED',
          startDate: { lte: end },
          endDate: { gte: start },
        },
        include: { leaveType: { select: { name: true } } },
      }),
      this.prisma.shift.findMany({ where: { companyId }, orderBy: { name: 'asc' } }),
    ]);

    const entryBy = new Map<string, typeof entries[number]>();
    for (const e of entries) entryBy.set(`${e.employeeId}|${toKey(e.date)}`, e);

    // A multi-day leave covers every day between its start and end.
    const leaveBy = new Map<string, { name: string; isHalfDay: boolean }>();
    for (const l of leaves) {
      for (let d = new Date(l.startDate); d <= l.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
        leaveBy.set(`${l.employeeId}|${toKey(d)}`, {
          name: l.leaveType?.name || 'Leave',
          isHalfDay: l.isHalfDay,
        });
      }
    }

    const rows = employees.map(emp => ({
      employee: {
        id: emp.id,
        name: [emp.firstName, emp.lastName].filter(Boolean).join(' '),
        employeeCode: emp.employeeCode,
        avatarUrl: emp.avatarUrl,
        department: emp.department?.name || null,
        designation: emp.designation?.name || null,
        isActive: emp.user?.status !== 'SUSPENDED',
      },
      defaultShift: emp.shift ? { id: emp.shift.id, name: emp.shift.name } : null,
      cells: days.map(day => {
        const key = `${emp.id}|${day}`;
        const leave = leaveBy.get(key);
        if (leave) {
          return { date: day, type: 'LEAVE', label: leave.name, isHalfDay: leave.isHalfDay };
        }
        const entry = entryBy.get(key);
        if (entry) {
          if (entry.isDayOff) return { date: day, type: 'DAY_OFF', entryId: entry.id, note: entry.note };
          if (entry.shift) {
            const onSite =
              entry.projectId || entry.address || entry.onsiteApprovalStatus !== 'NONE'
                ? {
                    projectId: entry.projectId as number | null,
                    projectName: entry.project?.name || null,
                    address: entry.address || null,
                    approvalStatus: entry.onsiteApprovalStatus,
                    startTime: entry.startTime,
                    endTime: entry.endTime,
                  }
                : undefined;
            return {
              date: day, type: 'SHIFT', entryId: entry.id, note: entry.note,
              shift: this.shiftBrief(entry.shift),
              onSite,
            };
          }
        }
        // Nothing rostered: fall back to the standing shift, unless it doesn't
        // run that weekday, in which case the day is off by definition.
        if (emp.shift) {
          const dayName = DAY_NAMES[new Date(`${day}T00:00:00Z`).getUTCDay()];
          const works = !emp.shift.workingDays || emp.shift.workingDays.split(',').includes(dayName);
          if (!works) return { date: day, type: 'DAY_OFF', isDefault: true };
          return { date: day, type: 'SHIFT', isDefault: true, shift: this.shiftBrief(emp.shift) };
        }
        return { date: day, type: 'UNASSIGNED' };
      }),
    }));

    return { days, shifts: shifts.map(s => this.shiftBrief(s)), rows };
  }

  private shiftBrief(s: any) {
    return {
      id: s.id, name: s.name, shortCode: s.shortCode, colorCode: s.colorCode,
      shiftType: s.shiftType, startTime: s.startTime, endTime: s.endTime,
      totalHours: s.totalHours, workingDays: s.workingDays,
    };
  }

  /**
   * The single source of truth for "what shift is this person on, this day?".
   *
   * Attendance used to read Employee.shift directly, which meant the roster —
   * including every on-site assignment — had no effect on clocking at all.
   * clockIn, clockOut and the auto-clock-out cron all resolve through here now.
   *
   * Order: an explicit roster entry wins, the standing shift is the fallback.
   *
   * A PENDING on-site row deliberately does NOT take effect. It is a *request*,
   * and letting it govern would let anyone move their own clock window — and
   * skip the branch geofence — just by filing one and never being approved.
   */
  async getEffectiveShift(
    employeeId: number,
    date: Date,
    standingShift?: { id: number; name: string; startTime: string | null; endTime: string | null; bufferTimeMinutes: number; workingDays: string | null } | null,
  ): Promise<EffectiveShift> {
    const standing =
      standingShift !== undefined
        ? standingShift
        : await this.prisma.employee
            .findUnique({ where: { id: employeeId }, select: { shift: true } })
            .then(e => e?.shift ?? null);

    const entry = await this.prisma.shiftRosterEntry.findUnique({
      where: { employeeId_date: { employeeId, date } },
      include: { shift: true },
    });

    const fromStanding = (): EffectiveShift => {
      if (!standing) return { source: 'NONE', shift: null, startTime: null, endTime: null, isDayOff: false, onsite: null };
      const dayName = DAY_NAMES[date.getUTCDay()];
      const works = !standing.workingDays || standing.workingDays.split(',').includes(dayName);
      return {
        source: 'STANDING',
        shift: { id: standing.id, name: standing.name, bufferTimeMinutes: standing.bufferTimeMinutes },
        startTime: standing.startTime,
        endTime: standing.endTime,
        isDayOff: !works,
        onsite: null,
      };
    };

    if (!entry) return fromStanding();

    if (entry.isDayOff) {
      return { source: 'ROSTER', shift: null, startTime: null, endTime: null, isDayOff: true, onsite: null };
    }

    // Unapproved on-site request — the row exists but must not govern.
    if (entry.onsiteApprovalStatus === 'PENDING') return fromStanding();

    const shift = entry.shift ?? standing;
    if (!shift) return { source: 'ROSTER', shift: null, startTime: null, endTime: null, isDayOff: false, onsite: null };

    const onsite =
      entry.projectId || entry.address
        ? { projectId: entry.projectId, address: entry.address }
        : null;

    return {
      source: 'ROSTER',
      shift: { id: shift.id, name: shift.name, bufferTimeMinutes: shift.bufferTimeMinutes },
      // The entry's own window wins; the shift's is the fallback.
      startTime: entry.startTime ?? shift.startTime,
      endTime: entry.endTime ?? shift.endTime,
      isDayOff: false,
      onsite,
    };
  }

  /**
   * A per-assignment clock window is only meaningful on an on-site shift, and
   * only as a pair — half a window would silently inherit the other half from
   * the shift and read as a bug. Crossing midnight is legitimate (night work),
   * so end-before-start is not an error.
   */
  private resolveWindow(
    isOnSite: boolean,
    data: { startTime?: string | null; endTime?: string | null },
  ): { startTime: string | null; endTime: string | null } {
    const start = data.startTime?.trim() || null;
    const end = data.endTime?.trim() || null;
    if (!start && !end) return { startTime: null, endTime: null };
    if (!isOnSite) {
      throw new BadRequestException('A custom clock window can only be set on an on-site shift');
    }
    if (!start || !end) {
      throw new BadRequestException('Enter both a start time and an end time, or leave both blank to use the shift timing');
    }
    if (!HHMM.test(start) || !HHMM.test(end)) {
      throw new BadRequestException('Times must be in 24-hour HH:mm format');
    }
    if (start === end) {
      throw new BadRequestException('Start and end time cannot be the same');
    }
    return { startTime: start, endTime: end };
  }

  /** Set (or clear) one employee's shift on one day. */
  async assign(companyId: number, a: RosterAssignment) {
    const date = dateKey(a.date);
    await this.assertEmployee(companyId, a.employeeId);
    const shift = a.shiftId ? await this.assertShift(companyId, a.shiftId) : null;

    // Clearing a cell removes the override so the standing shift shows again.
    if (!a.shiftId && !a.isDayOff) {
      await this.prisma.shiftRosterEntry.deleteMany({ where: { employeeId: a.employeeId, date } });
      return { cleared: true };
    }

    const onSite = await this.resolveOnSiteDetails(companyId, shift, a);
    const window = this.resolveWindow(onSite.isOnSite, a);

    // On-site "No Project" request — the row is held for Administrator + HR.
    if (onSite.needsApproval) {
      const entry = await this.prisma.shiftRosterEntry.upsert({
        where: { employeeId_date: { employeeId: a.employeeId, date } },
        update: {
          shiftId: a.shiftId,
          isDayOff: !!a.isDayOff,
          projectId: null,
          address: onSite.address,
          startTime: window.startTime,
          endTime: window.endTime,
          onsiteApprovalStatus: 'PENDING',
          approvedByUserId: null,
          note: a.note ?? 'On-site (No Project) — awaiting approval',
        },
        create: {
          employeeId: a.employeeId, date, companyId,
          shiftId: a.isDayOff ? null : a.shiftId,
          isDayOff: !!a.isDayOff,
          address: onSite.address,
          startTime: window.startTime,
          endTime: window.endTime,
          onsiteApprovalStatus: 'PENDING',
          note: 'On-site (No Project) — awaiting approval',
        },
      });
      await this.notifyOnsiteApprovers(companyId, a.employeeId, date);
      return entry;
    }

    return this.prisma.shiftRosterEntry.upsert({
      where: { employeeId_date: { employeeId: a.employeeId, date } },
      update: {
        shiftId: a.isDayOff ? null : a.shiftId,
        isDayOff: !!a.isDayOff,
        projectId: onSite.projectId,
        address: onSite.address,
        startTime: window.startTime,
        endTime: window.endTime,
        onsiteApprovalStatus: 'NONE',
        approvedByUserId: null,
        note: a.note ?? null,
      },
      create: {
        employeeId: a.employeeId, date, companyId,
        shiftId: a.isDayOff ? null : a.shiftId,
        isDayOff: !!a.isDayOff,
        projectId: onSite.projectId,
        address: onSite.address,
        startTime: window.startTime,
        endTime: window.endTime,
        onsiteApprovalStatus: 'NONE',
        note: a.note ?? null,
      },
    });
  }

  /**
   * Roster a shift across a date range for many employees at once — the
   * equivalent of Workway's "Automate Shifts". Days the shift does not operate
   * become days off rather than being skipped, so the grid stays explicit.
   */
  async bulkAssign(companyId: number, data: {
    employeeIds: number[]; start: string; end: string;
    shiftId?: number | null; isDayOff?: boolean;
    skipNonWorkingDays?: boolean; overwriteExisting?: boolean;
    /** On-site shift details (used when the bulk shift is an on-site shift). */
    projectId?: number | null;
    address?: string | null;
    needsApproval?: boolean;
    /** Clock window applied to every day in the range, "HH:mm" IST. */
    startTime?: string | null;
    endTime?: string | null;
  }) {
    const { employeeIds = [], start, end } = data;
    if (!employeeIds.length) throw new BadRequestException('Select at least one employee');
    const from = dateKey(start);
    const to = dateKey(end);
    if (to < from) throw new BadRequestException('end must not be before start');

    const shift = data.shiftId ? await this.assertShift(companyId, data.shiftId) : null;
    const onSite = await this.resolveOnSiteDetails(companyId, shift, data);
    const window = this.resolveWindow(onSite.isOnSite, data);
    const valid = await this.prisma.employee.findMany({
      where: { companyId, id: { in: employeeIds } }, select: { id: true },
    });
    const validIds = new Set(valid.map(v => v.id));

    const working = shift?.workingDays ? shift.workingDays.split(',') : null;
    const rows: {
      employeeId: number; date: Date; shiftId: number | null; isDayOff: boolean; companyId: number;
      projectId: number | null; address: string | null; onsiteApprovalStatus: string;
      startTime: string | null; endTime: string | null;
    }[] = [];
    for (const employeeId of employeeIds) {
      if (!validIds.has(employeeId)) continue;
      for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        const offDay = !!working && !working.includes(DAY_NAMES[d.getUTCDay()]);
        if (offDay && data.skipNonWorkingDays) continue;
        rows.push({
          employeeId, date: new Date(d), companyId,
          shiftId: data.isDayOff || offDay ? null : (data.shiftId ?? null),
          isDayOff: !!data.isDayOff || offDay,
          projectId: onSite.projectId,
          address: onSite.address,
          onsiteApprovalStatus: onSite.needsApproval && !data.isDayOff ? 'PENDING' : 'NONE',
          // A day the shift doesn't operate is an off day; a window on it would
          // be meaningless and would show up as a phantom time on the grid.
          startTime: data.isDayOff || offDay ? null : window.startTime,
          endTime: data.isDayOff || offDay ? null : window.endTime,
        });
      }
    }
    if (!rows.length) return { written: 0, skipped: 0 };

    if (data.overwriteExisting === false) {
      // Leave existing entries alone; only fill empty cells.
      const existing = await this.prisma.shiftRosterEntry.findMany({
        where: { companyId, employeeId: { in: [...validIds] }, date: { gte: from, lte: to } },
        select: { employeeId: true, date: true },
      });
      const taken = new Set(existing.map(e => `${e.employeeId}|${toKey(e.date)}`));
      const fresh = rows.filter(r => !taken.has(`${r.employeeId}|${toKey(r.date)}`));
      if (fresh.length) await this.prisma.shiftRosterEntry.createMany({ data: fresh });
      return { written: fresh.length, skipped: rows.length - fresh.length };
    }

    // Replace the range outright, then insert — far cheaper than N upserts.
    await this.prisma.shiftRosterEntry.deleteMany({
      where: { companyId, employeeId: { in: [...validIds] }, date: { gte: from, lte: to } },
    });
    for (let i = 0; i < rows.length; i += 1000) {
      await this.prisma.shiftRosterEntry.createMany({ data: rows.slice(i, i + 1000) });
    }

    // "No Project" bulk — alert the Administrator + HR once per affected person.
    if (onSite.needsApproval && !data.isDayOff) {
      for (const employeeId of validIds) {
        await this.notifyOnsiteApprovers(companyId, employeeId, from);
      }
    }

    return { written: rows.length, skipped: 0 };
  }

  async clearRange(companyId: number, data: { employeeIds: number[]; start: string; end: string }) {
    const res = await this.prisma.shiftRosterEntry.deleteMany({
      where: {
        companyId,
        employeeId: { in: data.employeeIds || [] },
        date: { gte: dateKey(data.start), lte: dateKey(data.end) },
      },
    });
    return { cleared: res.count };
  }

  /** Pending on-site ("No Project") requests awaiting Administrator/HR. */
  async getPendingOnsiteApprovals(companyId: number) {
    return this.prisma.shiftRosterEntry.findMany({
      where: { companyId, onsiteApprovalStatus: 'PENDING' },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: true, department: { select: { name: true } } },
        },
        shift: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ date: 'asc' }, { employee: { firstName: 'asc' } }],
    });
  }

  /** Approve or reject an on-site "No Project" request. Only Admins and HR. */
  async resolveOnsiteApproval(
    companyId: number,
    entryId: number,
    action: 'APPROVED' | 'REJECTED',
    actorUserId: number,
    actorRole: string,
  ) {
    if (!['ADMIN', 'HR', 'SUPERADMIN'].includes(actorRole)) {
      throw new ForbiddenException('Only Administrators and HR can approve on-site requests');
    }
    const entry = await this.prisma.shiftRosterEntry.findFirst({ where: { id: entryId, companyId } });
    if (!entry) throw new NotFoundException('On-site request not found');
    if (entry.onsiteApprovalStatus !== 'PENDING') {
      throw new BadRequestException('Request is no longer pending');
    }

    if (action === 'REJECTED') {
      // Falls back to the standing shift — the on-site assignment is voided.
      await this.prisma.shiftRosterEntry.delete({ where: { id: entryId } });
      await this.notifyRequester(entry, 'REJECTED');
      return { id: entryId, status: 'REJECTED', entryId };
    }

    const updated = await this.prisma.shiftRosterEntry.update({
      where: { id: entryId },
      data: { onsiteApprovalStatus: 'APPROVED', approvedByUserId: actorUserId },
    });
    await this.notifyRequester(entry, 'APPROVED');
    return updated;
  }

  /** Best-effort notification to Administrator + HR that an on-site request needs them. */
  private async notifyOnsiteApprovers(companyId: number, employeeId: number, date: Date) {
    try {
      const emp = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { userId: true, firstName: true, lastName: true },
      });
      const name = emp ? `${emp.firstName} ${emp.lastName}`.trim() : `Employee #${employeeId}`;
      await this.notifications.notifyApprovers({
        companyId,
        roles: ['ADMIN', 'HR', 'SUPERADMIN'],
        title: 'On-site request awaiting approval',
        message: `${name} requested On-site work (No Project) on ${toKey(date)}`,
        type: 'ACTION_REQUIRED',
        linkUrl: '/attendance/shift-roster',
        excludeUserId: emp?.userId ?? undefined,
      });
    } catch {
      // Notifications are best-effort — never fail an assignment because of one.
    }
  }

  /** Tell the requester their on-site request was decided. */
  private async notifyRequester(
    entry: { employeeId: number; date: Date },
    status: 'APPROVED' | 'REJECTED',
  ) {
    try {
      const emp = await this.prisma.employee.findUnique({
        where: { id: entry.employeeId },
        select: { userId: true, firstName: true, lastName: true },
      });
      if (!emp?.userId) return;
      await this.notifications.createNotification(
        emp.userId,
        status === 'APPROVED' ? 'On-site request approved' : 'On-site request rejected',
        `Your on-site (No Project) request for ${toKey(entry.date)} was ${status.toLowerCase()}.`,
        status === 'APPROVED' ? 'SUCCESS' : 'INFO',
        '/attendance/shift-roster',
      );
    } catch {
      // Best-effort.
    }
  }

  private async assertEmployee(companyId: number, employeeId: number) {
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true } });
    if (!e) throw new BadRequestException('Employee not found');
    return e;
  }

  private async assertShift(companyId: number, shiftId: number) {
    const s = await this.prisma.shift.findFirst({ where: { id: shiftId, companyId } });
    if (!s) throw new BadRequestException('Shift not found');
    return s;
  }

  /**
   * Enforce the on-site workflow on the server as well as in the UI. This
   * prevents direct API calls from creating an on-site assignment without a
   * project (or the explicit No Project approval path) and a work address.
   */
  private async resolveOnSiteDetails(
    companyId: number,
    shift: { name: string } | null,
    data: { isDayOff?: boolean; projectId?: number | null; address?: string | null; needsApproval?: boolean },
  ) {
    const isOnSite = !!shift?.name && shift.name.toLowerCase().replace(/[^a-z]/g, '').includes('onsite');
    const requestedAddress = data.address?.trim() || null;

    if (!isOnSite || data.isDayOff) {
      if (data.needsApproval || data.projectId || requestedAddress) {
        throw new BadRequestException('Project and address details can only be used with an on-site shift');
      }
      return { projectId: null, address: null, needsApproval: false, isOnSite: false };
    }

    if (data.needsApproval) {
      if (data.projectId) throw new BadRequestException('Choose either a project or No Project, not both');
      if (!requestedAddress) throw new BadRequestException('Enter the on-site address');
      return { projectId: null, address: requestedAddress, needsApproval: false, isOnSite: true };
    }

    if (!data.projectId) {
      if (!requestedAddress) throw new BadRequestException('Enter an on-site address');
      return { projectId: null, address: requestedAddress, needsApproval: false, isOnSite: true };
    }
    const project = await this.prisma.project.findFirst({
      where: { id: data.projectId, companyId },
      select: { id: true, address: true },
    });
    if (!project) throw new BadRequestException('Selected project was not found');

    // The configured project address is the default, while a user-entered
    // address can be retained for a specific site visit.
    const address = requestedAddress || project.address?.trim() || null;
    if (!address) throw new BadRequestException('The selected project has no address; enter an on-site address');
    return { projectId: project.id, address, needsApproval: false, isOnSite: true };
  }
}
