import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
}

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
  constructor(private prisma: PrismaService) {}

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
        include: { shift: true },
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
            return {
              date: day, type: 'SHIFT', entryId: entry.id, note: entry.note,
              shift: this.shiftBrief(entry.shift),
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

  /** Set (or clear) one employee's shift on one day. */
  async assign(companyId: number, a: RosterAssignment) {
    const date = dateKey(a.date);
    await this.assertEmployee(companyId, a.employeeId);
    if (a.shiftId) await this.assertShift(companyId, a.shiftId);

    // Clearing a cell removes the override so the standing shift shows again.
    if (!a.shiftId && !a.isDayOff) {
      await this.prisma.shiftRosterEntry.deleteMany({ where: { employeeId: a.employeeId, date } });
      return { cleared: true };
    }

    return this.prisma.shiftRosterEntry.upsert({
      where: { employeeId_date: { employeeId: a.employeeId, date } },
      update: { shiftId: a.isDayOff ? null : a.shiftId, isDayOff: !!a.isDayOff, note: a.note ?? null },
      create: {
        employeeId: a.employeeId, date, companyId,
        shiftId: a.isDayOff ? null : a.shiftId, isDayOff: !!a.isDayOff, note: a.note ?? null,
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
  }) {
    const { employeeIds = [], start, end } = data;
    if (!employeeIds.length) throw new BadRequestException('Select at least one employee');
    const from = dateKey(start);
    const to = dateKey(end);
    if (to < from) throw new BadRequestException('end must not be before start');

    const shift = data.shiftId ? await this.assertShift(companyId, data.shiftId) : null;
    const valid = await this.prisma.employee.findMany({
      where: { companyId, id: { in: employeeIds } }, select: { id: true },
    });
    const validIds = new Set(valid.map(v => v.id));

    const working = shift?.workingDays ? shift.workingDays.split(',') : null;
    const rows: { employeeId: number; date: Date; shiftId: number | null; isDayOff: boolean; companyId: number }[] = [];
    for (const employeeId of employeeIds) {
      if (!validIds.has(employeeId)) continue;
      for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        const offDay = !!working && !working.includes(DAY_NAMES[d.getUTCDay()]);
        if (offDay && data.skipNonWorkingDays) continue;
        rows.push({
          employeeId, date: new Date(d), companyId,
          shiftId: data.isDayOff || offDay ? null : (data.shiftId ?? null),
          isDayOff: !!data.isDayOff || offDay,
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
}
