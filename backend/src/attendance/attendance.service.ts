import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { istDateKey, istTimeInstant } from '../common/timezone.util';
import { LateClockOutError, OpenSessionError, OutsideOfficeError } from './open-session.error';
import { haversineKm, distanceAllowingAccuracyM } from '../common/geo.util';
import { FIELD_VISIT_STATUS, FIELD_VISIT_DAY } from '../field-visits/field-visit-status';
import { NotificationsService } from '../notifications/notifications.service';
import { ShiftRosterService, EffectiveShift } from './shift-roster.service';
import { ShiftPeriod, resolvePeriod, datesInRange } from './shift-period-summary';
import { CLOCK_OUT_APPROVAL, UNQUEUED_CLOCKOUT_FROM } from './clock-out-approval';
import { isHalfDayStart } from './half-day-rule';
import { ApprovalsService } from '../approvals/approvals.service';
import { APPROVAL_WORKFLOW } from '../approvals/approval-workflows';
import { isCompanyAdmin, isHrAdmin } from '../common/company-roles';
import { isBranchWeeklyOff } from '../common/weekly-offs';
import { isRestDay } from '../common/rest-day';

/**
 * What the field visit clock tells attendance about the day it is clocking.
 * Its presence is also the assertion that the site geofence has already been
 * applied.
 */
export interface FieldVisitClockContext {
  requestId: number;
  requestNumber: string;
  projectId: number | null;
}

/** Leave types and profile locations that mean Work From Home. */
const WFH_NAME = /work\s*from\s*home|wfh|remote/i;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** The profile's weekday setting (Home), else its Work Location. */
function profileSaysWfh(emp: { workLocation?: string | null; usualWorkLocation?: any } | null, day: Date): boolean {
  if (!emp) return false;
  const usual = emp.usualWorkLocation && typeof emp.usualWorkLocation === 'object'
    ? String(emp.usualWorkLocation[WEEKDAYS[day.getUTCDay()]] ?? '') : '';
  if (usual && usual !== 'Unspecified') return /^home$/i.test(usual);
  return WFH_NAME.test(String(emp.workLocation ?? ''));
}

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private roster: ShiftRosterService,
    private approvals: ApprovalsService,
  ) {}

  async importAttendance(companyId: number, rows: Array<{ employeeId: number; date: string; status?: string; clockIn?: string; clockOut?: string }>) {
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('At least one attendance row is required.');
    if (rows.length > 2000) throw new BadRequestException('Import is limited to 2,000 rows at a time.');
    const employeeIds = [...new Set(rows.map((row) => Number(row.employeeId)).filter(Number.isInteger))];
    const employees = await this.prisma.employee.findMany({ where: { companyId, id: { in: employeeIds } }, select: { id: true } });
    const allowed = new Set(employees.map((employee) => employee.id));
    let imported = 0;
    for (const row of rows) {
      const employeeId = Number(row.employeeId);
      if (!allowed.has(employeeId) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
      const status = ['PRESENT', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF'].includes(String(row.status).toUpperCase())
        ? String(row.status).toUpperCase() : 'PRESENT';
      const clockIn = row.clockIn ? new Date(row.clockIn) : null;
      const clockOut = row.clockOut ? new Date(row.clockOut) : null;
      if ((clockIn && Number.isNaN(clockIn.getTime())) || (clockOut && Number.isNaN(clockOut.getTime()))) continue;
      await this.prisma.attendance.upsert({
        where: { employeeId_date: { employeeId, date: new Date(`${row.date}T00:00:00.000Z`) } },
        create: { employeeId, date: new Date(`${row.date}T00:00:00.000Z`), status, clockIn, clockOut },
        update: { status, clockIn, clockOut },
      });
      imported++;
    }
    return { imported, skipped: rows.length - imported };
  }

  /** Roster rows in a range, for the attendance grid's rest-day rule. */
  async getRosterDays(companyId: number, from: string, to: string, employeeId?: number) {
    const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isDay(from) || !isDay(to)) throw new BadRequestException('from and to must be dates (YYYY-MM-DD)');
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    if (end.getTime() - start.getTime() > 400 * 86400000) throw new BadRequestException('Ask for at most about a year at a time');
    const rows = await this.prisma.shiftRosterEntry.findMany({
      where: { companyId, date: { gte: start, lte: end }, ...(employeeId != null ? { employeeId } : {}) },
      select: { employeeId: true, date: true, isDayOff: true, onsiteApprovalStatus: true },
    });
    // An unapproved on-site request decides nothing, as in isRestDay.
    return rows
      .filter((r) => r.isDayOff || r.onsiteApprovalStatus !== 'PENDING')
      .map((r) => ({ employeeId: r.employeeId, date: r.date.toISOString().slice(0, 10), isDayOff: r.isDayOff }));
  }

  /**
   * Credit a completed attendance day that falls on Sunday or the employee's
   * roster/branch day off. The unique attendanceId ledger row is the guard
   * against duplicate credits when a clock-out is retried or later approved.
   */
  private async grantCompOffIfEligible(attendanceId: number): Promise<void> {
    const attendance = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: { employee: { include: { shift: true, branch: true } }, compOffCredit: true },
    });
    if (!attendance?.clockIn || !attendance.clockOut || attendance.compOffCredit) return;
    if (attendance.clockOutApproval === CLOCK_OUT_APPROVAL.PENDING || attendance.clockOutApproval === CLOCK_OUT_APPROVAL.REJECTED) return;

    const date = attendance.date;
    const holiday = await this.isHoliday(attendance.employee.companyId, date);
    const entry = await this.prisma.shiftRosterEntry.findUnique({
      where: { employeeId_date: { employeeId: attendance.employeeId, date } },
      select: { isDayOff: true, onsiteApprovalStatus: true },
    });
    // The same rest-day rule payroll uses: the roster row, else a shift that
    // actually has days off, else the branch weekly off. Before 15 Oct 2026
    // every Sunday counted, so rostered Sunday shifts earned comp-off.
    const dayOff = isRestDay(date, entry, attendance.employee.shift?.workingDays, attendance.employee.branch?.weeklyOffs);
    if (!dayOff && !holiday) return;

    // Comp-off is earned only for an approved field visit that day (decided
    // 15 Oct 2026); clocking in on a day off by itself no longer credits it.
    const onVisit = await this.prisma.fieldVisitAttendance.findFirst({
      where: {
        employeeId: attendance.employeeId,
        visitDate: date,
        request: { status: { in: ['APPROVED', 'COMPLETED'] } },
      },
      select: { id: true },
    });
    if (!onVisit) return;

    const companyId = attendance.employee.companyId;
    const year = date.getUTCFullYear();
    // The company's comp-off type: the one flagged isCompOff, else an existing
    // type plainly named for it ("Compensatory Off", "Comp Off", "Comp-Off"),
    // which is then flagged. Only created when none exists, so a second
    // look-alike type never appears beside the one people already use.
    let leaveType = await this.prisma.leaveType.findFirst({ where: { companyId, isCompOff: true } })
      ?? await this.prisma.leaveType.findFirst({
        where: {
          companyId,
          OR: ['Compensatory Off', 'Comp Off', 'Comp-Off'].map((name) => ({ name: { equals: name, mode: 'insensitive' as const } })),
        },
        orderBy: { id: 'asc' },
      });
    if (leaveType && !leaveType.isCompOff) {
      leaveType = await this.prisma.leaveType.update({ where: { id: leaveType.id }, data: { isCompOff: true } });
    }
    if (!leaveType) {
      leaveType = await this.prisma.leaveType.create({
        data: {
          companyId, name: 'Compensatory Off', description: 'Automatically credited for working on a Sunday, holiday or scheduled day off.',
          defaultDays: 0, accrualFrequency: 'NONE', accrualAmount: 0, isPaid: true, allowHalfDay: false, isCompOff: true,
        },
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Re-check inside the transaction for normal sequential requests.
        const credited = await tx.compOffCredit.findUnique({ where: { attendanceId } });
        if (credited) return;
        await tx.compOffCredit.create({
          data: {
            attendanceId,
            companyId,
            employeeId: attendance.employeeId,
            leaveTypeId: leaveType.id,
            date,
            reason: 'ATTENDANCE_DAY_OFF',
            year,
          },
        });
        await tx.leaveBalance.upsert({
          where: { employeeId_leaveTypeId_year: { employeeId: attendance.employeeId, leaveTypeId: leaveType.id, year } },
          create: { employeeId: attendance.employeeId, leaveTypeId: leaveType.id, year, allocated: 1 },
          update: { allocated: { increment: 1 } },
        });
      });
    } catch (error: any) {
      // A concurrent completion may win the unique attendanceId race. Its
      // transaction has already created the credit and balance, so there is
      // nothing to retry or compensate.
      if (error?.code !== 'P2002') throw error;
    }
  }

  async getTodayAttendance(userId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee profile not found');

    const now = new Date();
    const today = istDateKey(now);

    const record = await this.prisma.attendance.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: today
        }
      },
      include: { logs: true }
    });

    // A night shift that started yesterday and is still running is "today"
    // for the clock: show it, so the person sees Clock Out and their timer.
    if (!record?.logs?.some((l) => !l.clockOut)) {
      const lastNight = await this.findOpenSessionBefore(employee.id, today);
      if (lastNight && await this.isOvernightContinuation(
        await this.prisma.employee.findUnique({ where: { id: employee.id }, include: { shift: true, branch: true } }),
        lastNight, today, now,
      )) {
        return { ...this.withTotalHours(lastNight), overnight: true };
      }
    }
    return this.withTotalHours(record);
  }

  private withTotalHours(record: any) {
    if (!record) return record;
    let totalHours = 0;
    if (record.logs && record.logs.length > 0) {
      for (const log of record.logs) {
        const end = log.clockOut || new Date();
        totalHours += Math.max(0, (end.getTime() - log.clockIn.getTime()) / 3600000);
      }
    } else if (record.clockIn) {
      const end = record.clockOut || new Date();
      totalHours = Math.max(0, (end.getTime() - record.clockIn.getTime()) / 3600000);
    }
    return { ...record, totalHours: parseFloat(totalHours.toFixed(2)) };
  }

  /**
   * How far back a history request reaches when the caller does not say.
   *
   * Both the web grid and the mobile timesheet render one month at a time and
   * should pass an explicit `from`/`to`. This default only covers older clients
   * that ask for everything; it is generous enough that month navigation keeps
   * working, while stopping a single request from shipping years of records.
   */
  private static readonly DEFAULT_HISTORY_MONTHS = 12;

  /**
   * The fields the attendance grids actually render. Selecting explicitly keeps
   * new columns from silently joining every response, and — with the employee
   * relation gone — is what keeps this endpoint small.
   */
  private static readonly HISTORY_SELECT = {
    id: true,
    date: true,
    clockIn: true,
    clockOut: true,
    clockInLat: true,
    clockInLng: true,
    clockOutLat: true,
    clockOutLng: true,
    status: true,
    isLate: true,
    isEarlyLeave: true,
    autoClockedOut: true,
    logs: {
      select: {
        id: true,
        clockIn: true,
        clockOut: true,
        clockInLat: true,
        clockInLng: true,
        clockOutLat: true,
        clockOutLng: true,
        autoClockedOut: true,
      },
    },
  } as const;

  /** Clamp a history request to a sane window. */
  private historyDateFilter(from?: string, to?: string) {
    const filter: { gte?: Date; lte?: Date } = {};

    const parsedFrom = from ? new Date(from) : null;
    const parsedTo = to ? new Date(to) : null;

    if (parsedFrom && !isNaN(parsedFrom.getTime())) {
      filter.gte = parsedFrom;
    } else {
      const fallback = new Date();
      fallback.setMonth(fallback.getMonth() - AttendanceService.DEFAULT_HISTORY_MONTHS);
      filter.gte = fallback;
    }

    if (parsedTo && !isNaN(parsedTo.getTime())) filter.lte = parsedTo;

    return filter;
  }

  async getMyHistory(userId: number, from?: string, to?: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!employee) throw new BadRequestException('Employee profile not found');

    return this.getHistoryFor(employee.id, from, to);
  }

  async getEmployeeHistory(employeeId: number, from?: string, to?: string) {
    return this.getHistoryFor(employeeId, from, to);
  }

  /**
   * Deliberately does NOT include the employee or their department.
   *
   * It used to, which attached a full copy of the same employee record to every
   * row — around 300 KB of pure duplication on a 600-row history, repeated on
   * every page load from both clients. Neither the web grid nor the mobile
   * timesheet ever read those fields; the caller already knows whose history it
   * asked for.
   */
  private getHistoryFor(employeeId: number, from?: string, to?: string) {
    return this.prisma.attendance
      .findMany({
        where: { employeeId, date: this.historyDateFilter(from, to) },
        select: AttendanceService.HISTORY_SELECT,
        orderBy: { date: 'desc' },
      })
      .then((rows) => rows.map((r) => this.withTotalHours(r)));
  }

  /**
   * `options.fieldVisit` marks a clock-in that came through the field visit
   * screen, which has already measured the person against the approved site.
   * Nothing else may set it.
   */
  /**
   * Whether the company has a holiday on this attendance day.
   *
   * Keyed on the day the shift STARTS (the attendance date), so a night shift
   * beginning on a holiday evening is the holiday's, and one that runs into a
   * holiday morning is not.
   */
  async isHoliday(companyId: number, day: Date): Promise<boolean> {
    const start = new Date(day);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const hit = await this.prisma.holiday.findFirst({
      where: { companyId, date: { gte: start, lt: end } },
      select: { id: true },
    });
    return !!hit;
  }

  async clockIn(
    userId: number,
    data: { lat?: number, lng?: number, accuracy?: number, ipAddress?: string, outsideReason?: string, outsideProofUrl?: string },
    options?: { fieldVisit?: FieldVisitClockContext },
  ) {
    const employee = await this.prisma.employee.findUnique({ 
      where: { userId },
      include: { shift: true, branch: true }
    });
    if (!employee) throw new BadRequestException('Employee profile not found');

    const nowForDay = new Date();
    const todayKey = istDateKey(nowForDay);

    // What the roster says about today — an on-site assignment, a rostered
    // shift, or (the usual case) nothing, in which case the standing shift
    // still applies exactly as before.
    const effective = this.workingWindow(await this.roster.getEffectiveShift(
      employee.id, todayKey, employee.shift, employee.branch ? employee.branch.weeklyOffs ?? '' : null,
    ));

    // A field visit day may also be clocked from here (TKT-029). Late and
    // half-day are still measured against the visit's own hours, because the
    // roster entry the approval wrote carries them. When clocking in on a field
    // visit day, they must be within the approved site's geofence radius.
    const visitDayToday = options?.fieldVisit ? null : await this.prisma.fieldVisitAttendance.findFirst({
      where: {
        employeeId: employee.id,
        visitDate: todayKey,
        request: { status: FIELD_VISIT_STATUS.APPROVED },
      },
      select: {
        id: true,
        clockInTime: true,
        request: {
          select: {
            requestNumber: true,
            location: true,
            latitude: true,
            longitude: true,
            geofenceRadiusM: true,
          },
        },
      },
    });

    const unopenedVisitDay = visitDayToday && !visitDayToday.clockInTime ? visitDayToday : null;

    // Enforce field visit geofence if clocking in on an approved field visit day
    if (visitDayToday && !options?.fieldVisit) {
      if (data.lat == null || data.lng == null || !Number.isFinite(data.lat) || !Number.isFinite(data.lng)) {
        throw new BadRequestException('Your GPS location is required to clock in on an approved field visit day.');
      }

      const visitLat = visitDayToday.request.latitude;
      const visitLng = visitDayToday.request.longitude;
      const radiusM = visitDayToday.request.geofenceRadiusM ?? 1000;
      const distanceKm = haversineKm(visitLat, visitLng, data.lat, data.lng);
      const distanceM = Math.round(distanceKm * 1000);
      const allowedM = Math.round(distanceAllowingAccuracyM(distanceKm, data.accuracy));

      if (allowedM > radiusM) {
        const spokenDist = distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)}km` : `${distanceM}m`;
        if (employee.userId) {
          await this.notificationsService?.createNotification(
            employee.userId,
            'Clock-in denied: outside field visit location',
            `${visitDayToday.request.requestNumber} at ${visitDayToday.request.location}: you were ${spokenDist} away, outside the ${radiusM}m radius.`,
            'WARNING',
            '/field-visits/my',
            employee.companyId,
          );
        }
        throw new BadRequestException(
          `Clock-in denied: You are outside the approved Field Visit location (${visitDayToday.request.requestNumber}). ` +
          `Please move within ${radiusM} metres of the site to Clock In. You are ${spokenDist} from ${visitDayToday.request.location}.`,
        );
      }
    }

    // On-site either because the roster says so, or because this came through
    // the field visit screen — which is on-site by definition, and says so even
    // if somebody has since edited the roster entry out from under the trip.
    const onsite = !!effective.onsite || !!options?.fieldVisit;

    const branch = employee.branch;
    if (branch) {
      // 1. IP Restriction Check
      // Skipped on-site: the whole point of an on-site day is that the person
      // is not on the office network.
      if (branch.allowedIps && !onsite) {
        const allowed = branch.allowedIps.split(',').map(ip => ip.trim());
        if (data.ipAddress && !allowed.includes(data.ipAddress)) {
          throw new BadRequestException(`Clock-in denied. IP Address ${data.ipAddress} is not in the allowed list.`);
        }
      }

    }

    // 2. Office geofence (B3) — see officeCheck. An approved Work From Home
    // day is not checked against the office either (19 Oct 2026).
    const wfhToday = !onsite && (await this.hasApprovedWfh(employee.id, new Date()));
    const office = await this.officeCheck(employee, effective, onsite || wfhToday, data);
    const outsideIn = this.outsideFields('in', office, data);

    // Nothing may start while something earlier is still running.
    //
    // The sweep no longer closes an abandoned session, so Monday's stays open
    // until a human closes it. Allowing Tuesday's clock-in on top would leave
    // two open sessions for one person and no way to tell which of them the
    // next clock-out belongs to — and Monday would silently accrue hours for as
    // long as it stayed open. Refusing is what forces the correction.
    const openEarlier = await this.findOpenSessionBefore(employee.id, todayKey);
    if (openEarlier) throw OpenSessionError.forDate(openEarlier.date);

    let existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: todayKey } },
      include: { logs: true }
    });

    if (existing) {
      const activeLog = existing.logs.find(l => !l.clockOut);
      if (activeLog) {
        throw new BadRequestException('Already clocked in');
      }
    }

    const now = new Date();
    let isLate = false;
    let isHalfDay = false;

    // Duration-only shifts have no startTime, so there is nothing to be late for.
    // The window comes from the roster when one is set for today, which is how
    // an on-site stint with its own hours stops reading as three hours late.
    const buffer = effective.shift?.bufferTimeMinutes ?? 0;
    // Working a holiday is recorded and nothing more (B1): no late mark and no
    // half day, because nobody was expected in.
    // A weekly off (e.g. 2nd Saturday) is treated the same way: worked, recorded, never late.
    const onHoliday = await this.isHoliday(employee.companyId, todayKey) || effective.isDayOff;
    if (effective.startTime && !onHoliday) {
      // Shift times ("09:00") are IST wall-clock, not server-local — istTimeInstant
      // resolves them to the correct real-world instant regardless of what
      // timezone this server's OS happens to be configured with.
      const expectedStart = istTimeInstant(now, effective.startTime);
      const maxStartTime = new Date(expectedStart.getTime() + buffer * 60000);

      if (now > maxStartTime) {
        isLate = true;
      }

      // Clocking in past the shift's half-day boundary is more than late — the
      // day reads as a half day from the start. The rule lives in
      // half-day-rule.ts, which also refuses a boundary configured at or before
      // the shift's own start: that setting halves everybody's day.
      isHalfDay = isHalfDayStart(
        now, effective.startTime, effective.shift?.halfDayTime, istTimeInstant,
      );
    }

    // A second (or later) session on a day already started. Lateness and the
    // late-start half day belong to the FIRST clock-in only; see the update below.
    const returning = !!existing;

    if (!existing) {
      existing = await this.prisma.attendance.create({
        data: {
          employeeId: employee.id,
          date: todayKey,
          clockIn: now,
          clockInLat: data.lat,
          clockInLng: data.lng,
          status: isHalfDay ? 'HALF_DAY' : 'PRESENT',
          isLate,
          shiftId: effective.shift?.id ?? null,
          projectId: effective.onsite?.projectId ?? options?.fieldVisit?.projectId ?? null,
          isOnsite: onsite,
          ...outsideIn,
        },
        include: { logs: true }
      });
    }

    if (unopenedVisitDay) {
      const hasFix = Number.isFinite(data?.lat) && Number.isFinite(data?.lng);
      await this.prisma.fieldVisitAttendance.update({
        where: { id: unopenedVisitDay.id },
        data: {
          clockInTime: now,
          clockInLat: data?.lat ?? null,
          clockInLng: data?.lng ?? null,
          clockInDistanceKm: hasFix
            ? haversineKm(unopenedVisitDay.request.latitude, unopenedVisitDay.request.longitude, data.lat!, data.lng!)
            : null,
          status: FIELD_VISIT_DAY.IN_PROGRESS,
        },
      });
    }

    await this.prisma.attendanceLog.create({
      data: {
        attendanceId: existing.id,
        clockIn: now,
        clockInLat: data.lat,
        clockInLng: data.lng
      }
    });

    const updated = await this.prisma.attendance.update({
      where: { id: existing.id },
      data: {
        ...(returning
          ? this.returningStatus(existing, effective, onHoliday)
          : { status: isHalfDay ? 'HALF_DAY' : 'PRESENT', isLate }),
        clockOut: null, // Reset clockOut on parent since they are active
        autoClockedOut: false, // reopened — the old cutoff no longer describes the day
        clockIn: existing.clockIn || now,
        clockInLat: existing.clockInLat || data.lat,
        clockInLng: existing.clockInLng || data.lng,
        // Don't overwrite what the first clock-in of the day captured; only
        // fill in a row that some other path created without this context.
        shiftId: existing.shiftId ?? effective.shift?.id ?? null,
        projectId: existing.projectId ?? effective.onsite?.projectId ?? null,
        isOnsite: existing.isOnsite || onsite,
        // A later clock-in outside the office re-opens the review; one inside
        // leaves an earlier outside clock-in (and its decision) as it was.
        ...(existing.clockInOutside ? {} : outsideIn),
      },
      include: { logs: true }
    });
    return this.withTotalHours(updated);
  }

  /**
   * The hours a day is scored against (16 Oct 2026).
   *
   * An approved field visit writes its window into the roster (say 07:00 to
   * 21:00). That window is when someone may be on site, not hours they must
   * work: scoring it as the shift made a 9:28–18:39 day "late" against 07:00
   * and a "left early" half day against 21:00. On an on-site day the person
   * is held to the overlap of their shift and the window, the later start and
   * the earlier end. Overnight times are left as they are.
   */
  private workingWindow<T extends { startTime: string | null; endTime: string | null; onsite?: any; shift?: any }>(effective: T): T {
    const shiftStart: string | null = effective.shift?.startTime ?? null;
    const shiftEnd: string | null = effective.shift?.endTime ?? null;
    if (!effective.onsite || !shiftStart || !shiftEnd || !effective.startTime || !effective.endTime) return effective;
    if (shiftEnd <= shiftStart || effective.endTime <= effective.startTime) return effective;
    const startTime = effective.startTime > shiftStart ? effective.startTime : shiftStart;
    const endTime = effective.endTime < shiftEnd ? effective.endTime : shiftEnd;
    if (endTime <= startTime) return effective;
    return { ...effective, startTime, endTime };
  }

  /**
   * The day's status when somebody clocks back in.
   *
   * Lateness and the late-start half day are judged on the FIRST clock-in of
   * the day — scoring the return instead marked anyone who stepped out (to a
   * client site, say) and came back after the half-day boundary as a half day.
   * And coming back cancels the "left early" half day the previous clock-out
   * wrote; the next clock-out scores the day again.
   */
  private returningStatus(existing: any, effective: any, onHoliday: boolean) {
    const lateStartHalfDay = !!effective.startTime && !onHoliday && !!existing.clockIn
      && isHalfDayStart(existing.clockIn, effective.startTime, effective.shift?.halfDayTime, istTimeInstant);
    const status = existing.isEarlyLeave
      ? (lateStartHalfDay ? 'HALF_DAY' : 'PRESENT')
      : (existing.status ?? 'PRESENT');
    return { status, isLate: !!existing.isLate, isEarlyLeave: false };
  }

  /**
   * The office geofence (B3).
   *
   * Applies only when the day's shift is an office shift (Shift.officeGeofence,
   * i.e. General Shift) and the day is not on-site or a field visit. Within the
   * branch radius is ordinary; outside it — or with no location at all — is
   * allowed but must carry a reason, and is then reviewed by an administrator.
   *
   * The pin is the employee's branch, or the company's first branch with
   * coordinates for someone with no branch set. A branch without a pin, or no
   * coordinates anywhere, means no check.
   */
  /**
   * Is this a Work From Home day for the person (19 Oct 2026)? Then the office
   * distance needs no approval. Same sources, in the same order, as the shift
   * roster: an approved WFH request for the day; else the profile's usual
   * location for that weekday (Home); else the profile's Work Location
   * ("Work from Home"). A weekday set to an office or Other is not WFH.
   */
  private async hasApprovedWfh(employeeId: number, day: Date): Promise<boolean> {
    return (await this.wfhSource(employeeId, day)) !== null;
  }

  /** 'REQUEST' | 'PROFILE' when the day is WFH, else null. */
  private async wfhSource(employeeId: number, day: Date): Promise<'REQUEST' | 'PROFILE' | null> {
    const ist = new Date(day.getTime() + 330 * 60_000);
    const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
    // An approved WFH request (19 Oct 2026), the way WFH is asked for now.
    if (this.prisma.wfhRequest?.findFirst) {
      const req = await this.prisma.wfhRequest.findFirst({ where: { employeeId, date: d, status: 'APPROVED' }, select: { id: true } });
      if (req) return 'REQUEST';
    }
    // Older WFH taken as a leave type. Focused unit tests stub only the delegates they use.
    if (this.prisma.leaveRequest?.findMany) {
      const leaves = await this.prisma.leaveRequest.findMany({
        where: { employeeId, status: 'APPROVED', deletedAt: null, startDate: { lte: d }, endDate: { gte: d } },
        select: { leaveType: { select: { name: true } } },
      });
      if (leaves.some((l) => WFH_NAME.test(l.leaveType?.name ?? ''))) return 'REQUEST';
    }
    if (!this.prisma.employee?.findUnique) return null;
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId }, select: { workLocation: true, usualWorkLocation: true },
    });
    return profileSaysWfh(emp, d) ? 'PROFILE' : null;
  }

  private async officeCheck(
    employee: { companyId: number; branch?: any },
    effective: EffectiveShift,
    exempt: boolean,
    data: { lat?: number; lng?: number; accuracy?: number },
  ): Promise<{ outside: boolean; distanceKm: number | null; branchName: string; radiusM: number } | null> {
    if (exempt || !effective.shift?.officeGeofence) return null;

    const hasPin = (b: any) => b && b.latitude != null && b.longitude != null && b.geofenceRadius;
    // A branch with no office pin (Bengaluru, Kolkata… before an office
    // exists) means no office check for its people — not a check against some
    // other branch's office. The company fallback is only for someone with no
    // branch set at all.
    if (employee.branch && !hasPin(employee.branch)) return null;
    const branch = hasPin(employee.branch)
      ? employee.branch
      : await this.prisma.branch.findFirst({
          where: { companyId: employee.companyId, latitude: { not: null }, longitude: { not: null } },
          orderBy: { id: 'asc' },
        });
    if (!hasPin(branch)) return null;

    const radiusM = branch.geofenceRadius as number;
    if (data.lat == null || data.lng == null) {
      // No reading is not a pass: the reason is what explains it.
      return { outside: true, distanceKm: null, branchName: branch.name, radiusM };
    }
    const distanceKm = haversineKm(branch.latitude, branch.longitude, data.lat, data.lng);
    // Inside when the office is within the fix's own margin of error (capped).
    const outside = distanceAllowingAccuracyM(distanceKm, data.accuracy) > radiusM;
    return { outside, distanceKm, branchName: branch.name, radiusM };
  }

  /** The Attendance fields one outside-office clock writes, or none. */
  private outsideFields(
    direction: 'in' | 'out',
    office: { outside: boolean; distanceKm: number | null; branchName: string; radiusM: number } | null,
    data: { outsideReason?: string; outsideProofUrl?: string },
  ): Record<string, any> {
    if (!office?.outside) return {};

    // Strict Office Geofence Enforcement for Clock-In:
    // Staff on an office geofenced shift must be physically within the branch geofence radius.
    // They cannot clock in from home or outside the office merely by supplying a text reason.
    // Remote / WFH clock-ins strictly require an approved WFH request or field visit.
    if (direction === 'in') {
      const where = office.distanceKm == null
        ? 'Your location could not be verified'
        : `You are ${office.distanceKm.toFixed(2)} km from ${office.branchName}`;
      throw new BadRequestException(
        `Clock-in denied: ${where}, outside the ${office.radiusM} m office geofence. ` +
        `You must be at the office to clock in, or submit an official Work From Home (WFH) request.`,
      );
    }

    const reason = String(data.outsideReason ?? '').trim();
    if (!reason) {
      throw new OutsideOfficeError(direction, office.branchName, office.distanceKm, office.radiusM);
    }
    const proof = String(data.outsideProofUrl ?? '').trim() || null;
    const km = office.distanceKm == null ? null : Math.round(office.distanceKm * 100) / 100;
    return {
      clockOutOutside: true,
      clockOutDistanceKm: km,
      clockOutOutsideReason: reason,
      clockOutOutsideProofUrl: proof,
      // Every new outside clock needs a decision, even if an earlier one today
      // was already approved.
      geofenceApproval: 'PENDING',
      geofenceReviewedById: null,
      geofenceReviewedAt: null,
      geofenceReviewNote: null,
    };
  }

  /**
   * The most recent session before `beforeDate` that was never clocked out.
   *
   * Shared by clock-in (which refuses while one exists) and clock-out (which
   * closes it), so the two can never disagree about what "still open" means.
   *
   * "Open" is an open LOG, not a parent row with no clockOut, and the
   * difference is the whole reason this comment is longer than the query.
   * Sharing a function was not enough: this asked the parent row and clockOut
   * asked the logs, so a row the two disagreed about trapped its owner
   * permanently. Clock-in refused -- "session still open from 21 Sept" -- and
   * the clock-out it sent them to found no open log and answered "Already
   * clocked out". No sequence of clicks got out of that, because the day the
   * dialog named was not a running session at all.
   *
   * Rows like that are ordinary: the Workway import and an approved
   * regularization both write clockIn and clockOut straight onto the parent
   * and create no logs, so any imported day Workway had no clock-out for
   * arrived pre-deadlocked. A session NEX itself opened always has its log.
   *
   * What such a row means is "this day is missing a clock-out" -- a record to
   * correct through regularization, not a shift still running. It no longer
   * blocks tomorrow, because there is nothing running to block it with.
   *
   * The converse too: an open log under a day that HAS a clock-out is not
   * running either. Clocking in always clears the parent's clockOut, so a
   * session NEX opened never sits under one. The import left exactly that --
   * a closed session plus an identical copy with no clock-out -- and it read
   * as "Session still open from 19 Feb" months later.
   */
  private async findOpenSessionBefore(employeeId: number, beforeDate: Date) {
    return this.prisma.attendance.findFirst({
      where: { employeeId, date: { lt: beforeDate }, clockOut: null, logs: { some: { clockOut: null } } },
      orderBy: { date: 'desc' },
      include: { logs: true },
    });
  }

  /** How long after a night shift's end its session still counts as running. */
  private static readonly OVERNIGHT_GRACE_MS = 4 * 3600000;

  /**
   * A night shift still running: the session opened YESTERDAY, on a shift
   * that crosses midnight (it ends at or before the time it starts), and it is
   * not yet past that end time plus a grace period.
   *
   * Without this, a night shift clocked in at 20:00 belonged to a "previous
   * day" from midnight on — the header could not see it (it only ever looked
   * at today), so it offered Clock In instead of Clock Out, and closing it in
   * the morning was treated as a forgotten clock-out needing a reason and an
   * approval.
   */
  private async isOvernightContinuation(employee: any, session: { date: Date }, todayKey: Date, now: Date) {
    if (todayKey.getTime() - session.date.getTime() !== 86400000) return false;
    const effective = await this.roster.getEffectiveShift(
      employee.id, session.date, employee.shift, employee.branch ? employee.branch.weeklyOffs ?? '' : null,
    );
    if (!effective?.startTime || !effective?.endTime || effective.endTime > effective.startTime) return false;
    const end = istTimeInstant(now, effective.endTime);
    return now.getTime() <= end.getTime() + AttendanceService.OVERNIGHT_GRACE_MS;
  }

  /**
   * Close the open session — today's, or an earlier one left hanging.
   *
   * Two things changed here when the automatic 23:00 clock-out was removed.
   *
   * First, this can no longer assume the session belongs to today. A shift
   * abandoned on Monday is still open on Tuesday morning, and the old lookup —
   * today's attendance row or nothing — answered "You must clock in first",
   * which was both wrong and unfixable from the UI.
   *
   * Second, when the session being closed belongs to an earlier IST day, the
   * clock-out time is not an observation of anything. The person is not at
   * work; they are closing a record. So it asks why, and it does not pay
   * overtime on the seventeen hours between the shift ending and someone
   * remembering. The real hours go through regularization, which is the path
   * that already exists for correcting a day.
   */
  async clockOut(
    userId: number,
    data: {
      lat?: number, lng?: number, accuracy?: number, reason?: string, proofUrl?: string,
      outsideReason?: string, outsideProofUrl?: string,
    },
    options?: { fieldVisit?: FieldVisitClockContext },
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: { shift: true, branch: true }
    });
    if (!employee) throw new BadRequestException('Employee profile not found');

    const now = new Date();
    const todayKey = istDateKey(now);

    // Clock-out is never refused for a field visit day (TKT-029). People
    // leave the site and then remember to clock out, and refusing them left
    // the day open with no way to close it. An open field visit day is closed
    // alongside, with where they actually were recorded against the site.
    const openVisitDay = options?.fieldVisit ? null : await this.prisma.fieldVisitAttendance.findFirst({
      where: {
        employeeId: employee.id,
        visitDate: todayKey,
        clockInTime: { not: null },
        clockOutTime: null,
        request: { status: FIELD_VISIT_STATUS.APPROVED },
      },
      select: { id: true, request: { select: { latitude: true, longitude: true } } },
    });

    let existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: todayKey } },
      include: { logs: true }
    });
    let activeLog = existing?.logs.find(l => !l.clockOut) ?? null;

    // Nothing open today — fall back to the abandoned session, if there is one.
    if (!activeLog) {
      const earlier = await this.findOpenSessionBefore(employee.id, todayKey);
      if (earlier) {
        existing = earlier;
        activeLog = earlier.logs.find(l => !l.clockOut) ?? null;
      }
    }

    if (!existing || !existing.clockIn) {
      throw new BadRequestException('You must clock in first');
    }
    if (!activeLog) {
      throw new BadRequestException('Already clocked out');
    }

    // Is this a previous day being closed after IST midnight? Comparing date
    // KEYS rather than elapsed hours is what makes "after midnight" exact: a
    // 23:50 clock-out of the same day is normal, 00:10 of the next is not,
    // and those are eleven times closer together than a fixed-hours rule
    // would treat them.
    const isPreviousDay = existing.date.getTime() < todayKey.getTime()
      && !(await this.isOvernightContinuation(employee, existing, todayKey, now));

    const reason = (data?.reason ?? '').trim();
    if (isPreviousDay && !reason) {
      throw new LateClockOutError(existing.date);
    }

    const effective = this.workingWindow(await this.roster.getEffectiveShift(
      employee.id, existing.date, employee.shift, employee.branch ? employee.branch.weeklyOffs ?? '' : null,
    ));

    // Office geofence (B3), on the same on-site exemption as clock-in — and
    // skipped entirely for a previous day. Someone closing Monday's session at
    // one in the morning is at home; that case has its own reason flow above.
    const exemptOut = isPreviousDay || !!effective.onsite || !!options?.fieldVisit;
    const officeOut = await this.officeCheck(
      employee, effective, exemptOut || (await this.hasApprovedWfh(employee.id, existing.date)), data,
    );
    const outsideOut = this.outsideFields('out', officeOut, data);

    let isEarlyLeave = false;
    let status = 'PRESENT';

    // A session closed on a previous day keeps its existing status. For a
    // same-day close, leaving before the scheduled end remains a half day.
    const onHoliday = await this.isHoliday(employee.companyId, existing.date) || effective.isDayOff;
    if (!isPreviousDay && effective.endTime && !onHoliday) {
      // Same IST-fixed resolution as clockIn — see the comment there.
      const expectedEnd = istTimeInstant(now, effective.endTime);

      if (now < expectedEnd) {
        isEarlyLeave = true;
        status = 'HALF_DAY';
      }
    } else if (isPreviousDay) {
      status = existing.status ?? 'PRESENT';
      isEarlyLeave = existing.isEarlyLeave;
    }

    await this.prisma.attendanceLog.update({
      where: { id: activeLog.id },
      data: {
        clockOut: now,
        clockOutLat: data.lat,
        clockOutLng: data.lng,
        // A person closed this one. Clearing rather than leaving the default
        // matters for a day the old sweep closed and a later clock-in reopened.
        autoClockedOut: false
      }
    });

    if (openVisitDay) {
      const hasFix = Number.isFinite(data?.lat) && Number.isFinite(data?.lng);
      await this.prisma.fieldVisitAttendance.update({
        where: { id: openVisitDay.id },
        data: {
          clockOutTime: now,
          clockOutLat: data?.lat ?? null,
          clockOutLng: data?.lng ?? null,
          clockOutDistanceKm: hasFix
            ? haversineKm(openVisitDay.request.latitude, openVisitDay.request.longitude, data.lat!, data.lng!)
            : null,
          status: FIELD_VISIT_DAY.COMPLETED,
        },
      });
    }

    const updated = await this.prisma.attendance.update({
      where: { id: existing.id },
      data: {
        clockOut: now,
        clockOutLat: data.lat, // We can track the latest clock out coords here too
        clockOutLng: data.lng,
        isEarlyLeave,
        status,
        // Retain the database field for historical records, but attendance no
        // longer awards overtime for newly closed sessions.
        overtimeHours: 0,
        autoClockedOut: false,
        ...outsideOut,
        // The reason is the permanent record that this day's clock-out time is
        // a closure rather than an observation. `missedClockOut` is the live
        // "still open and overdue" state and is spent the moment it closes.
        //
        // §Att4/§Att5: the proof and the queue go on at the same moment and for
        // the same reason. The day is closed so the employee is not left with a
        // session they cannot shut, but it enters PENDING and does not count as
        // attended until somebody rules on it — see clock-out-approval.ts.
        ...(isPreviousDay
          ? {
              clockOutReason: reason,
              clockOutProofUrl: data.proofUrl ?? null,
              clockOutApproval: CLOCK_OUT_APPROVAL.PENDING,
              clockOutApprovedById: null,
              clockOutApprovedAt: null,
              clockOutReviewNote: null,
            }
          : {}),
        missedClockOut: false,
      },
      include: { logs: true }
    });

    // Previous-day clock-outs await approval; a completed same-day off-day
    // shift earns its Comp Off immediately.
    if (!isPreviousDay) await this.grantCompOffIfEligible(updated.id);
    return this.withTotalHours(updated);
  }

  /**
   * May this person rule on late clock-outs (§Att5)?
   *
   * Super Admin and HR always can — that is the company's own structure and
   * not the super admin's to revoke. On top of that sits the delegation:
   * named people put on the CLOCK_OUT queue, so the screen can be handed to
   * an office manager without handing them an HR role that carries far more.
   *
   * Combining a contextual rule with the delegate table is the pattern
   * ApprovalsService documents; it deliberately does not know about HR.
   */
  async mayApproveClockOut(
    companyId: number,
    role?: string | null,
    employeeId?: number | null,
  ): Promise<boolean> {
    if (isHrAdmin(role)) return true;
    return this.approvals.mayApprove(
      companyId, APPROVAL_WORKFLOW.CLOCK_OUT, role, employeeId,
    );
  }

  private async assertMayApproveClockOut(
    companyId: number, role?: string | null, employeeId?: number | null,
  ) {
    if (!(await this.mayApproveClockOut(companyId, role, employeeId))) {
      throw new ForbiddenException(
        'You are not on the late clock-out approval list. A Super Admin can add you.',
      );
    }
  }

  /**
   * The queue: days closed out of a previous session and not yet ruled on.
   *
   * Oldest first. A clock-out approval is not a pile to triage by importance —
   * the person is waiting on their own attendance record, and the one that has
   * waited longest is the one to answer.
   */
  /**
   * Today at a glance for the All People Attendance page: who is in, late,
   * half day, on leave, off, and who has not clocked in yet — for the IST
   * calendar day, whatever the server's own timezone.
   *
   * "Not clocked in yet" rather than "Absent": during the day it is not yet a
   * fact. Counts only active people (suspended accounts are excluded), and a
   * rostered day off is not counted as missing.
   */
  /**
   * The day at a glance (21 Oct 2026: any day and one department, not only
   * today). `date` is YYYY-MM-DD; without it, today in IST.
   */
  async getTodaySummary(companyId: number, opts: { date?: string; departmentId?: number } = {}) {
    const now = new Date();
    const today = opts.date ? new Date(`${opts.date}T00:00:00.000Z`) : istDateKey(now);
    const tomorrow = new Date(today.getTime() + 86400000);

    const people = await this.prisma.employee.findMany({
      where: { companyId, user: { status: { not: 'SUSPENDED' } }, ...(opts.departmentId ? { departmentId: opts.departmentId } : {}) },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true,
        department: { select: { name: true } }, designation: { select: { name: true } },
      },
      orderBy: { firstName: 'asc' },
    });
    const ids = people.map((p) => p.id);

    const [records, leaves, daysOff, pendingLeaves] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { employeeId: { in: ids }, date: { gte: today, lt: tomorrow } },
        select: { employeeId: true, clockIn: true, clockOut: true, status: true, isLate: true, isOnsite: true, clockInOutside: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: { in: ids }, status: 'APPROVED', deletedAt: null, startDate: { lt: tomorrow }, endDate: { gte: today } },
        select: { employeeId: true, isHalfDay: true, leaveType: { select: { name: true } } },
      }),
      this.prisma.shiftRosterEntry.findMany({
        where: { employeeId: { in: ids }, date: today, isDayOff: true },
        select: { employeeId: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: { in: ids }, status: 'PENDING', deletedAt: null, startDate: { lt: tomorrow }, endDate: { gte: today } },
        select: { employeeId: true, isHalfDay: true, reason: true, leaveType: { select: { name: true } } },
      }),
    ]);

    const clocked = records.filter((r) => r.clockIn);
    const clockedIds = new Set(clocked.map((r) => r.employeeId));
    const leaveIds = new Set(leaves.map((l) => l.employeeId).filter((id) => !clockedIds.has(id)));
    const offIds = new Set(daysOff.map((d) => d.employeeId).filter((id) => !clockedIds.has(id) && !leaveIds.has(id)));

    // Who is behind each number (19 Oct 2026), for the KPI pop-up.
    const byId = new Map(people.map((p) => [p.id, p]));
    const recById = new Map(clocked.map((r) => [r.employeeId, r]));
    const leaveById = new Map(leaves.map((l) => [l.employeeId, l]));
    const pendingLeaveById = new Map(pendingLeaves.map((l) => [l.employeeId, l]));
    const person = (id: number) => {
      const p = byId.get(id);
      const r = recById.get(id);
      const l = leaveById.get(id);
      const pl = pendingLeaveById.get(id);
      return {
        id, name: `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim(), employeeCode: p?.employeeCode ?? null,
        avatarUrl: p?.avatarUrl ?? null, department: p?.department?.name ?? null, designation: p?.designation?.name ?? null,
        clockIn: r?.clockIn ?? null, clockOut: r?.clockOut ?? null, isLate: !!r?.isLate, status: r?.status ?? null,
        where: r ? (r.isOnsite ? 'On site' : r.clockInOutside ? 'WFH / outside' : 'Office') : null,
        leaveType: l?.leaveType?.name ?? null, halfDayLeave: !!l?.isHalfDay,
        pendingLeave: pl ? { leaveType: pl.leaveType?.name ?? 'Leave', reason: pl.reason, isHalfDay: !!pl.isHalfDay } : null,
      };
    };
    const list = (rows: number[]) => rows.map(person);
    const lists = {
      clockedIn: list(clocked.map((r) => r.employeeId)),
      present: list(clocked.filter((r) => r.status !== 'HALF_DAY' && !r.isLate).map((r) => r.employeeId)),
      late: list(clocked.filter((r) => r.isLate && r.status !== 'HALF_DAY').map((r) => r.employeeId)),
      halfDay: list(clocked.filter((r) => r.status === 'HALF_DAY').map((r) => r.employeeId)),
      onLeave: list([...leaveIds]),
      dayOff: list([...offIds]),
      notClockedIn: list(ids.filter((id) => !clockedIds.has(id) && !leaveIds.has(id) && !offIds.has(id))),
    };

    return {
      lists,
      date: today.toISOString().slice(0, 10),
      totalEmployees: ids.length,
      clockedIn: clocked.length,
      present: clocked.filter((r) => r.status !== 'HALF_DAY' && !r.isLate).length,
      late: clocked.filter((r) => r.isLate && r.status !== 'HALF_DAY').length,
      halfDay: clocked.filter((r) => r.status === 'HALF_DAY').length,
      stillWorking: clocked.filter((r) => !r.clockOut).length,
      onLeave: leaveIds.size,
      dayOff: offIds.size,
      notClockedIn: Math.max(ids.length - clockedIds.size - leaveIds.size - offIds.size, 0),
      office: clocked.filter((r) => !r.isOnsite && !r.clockInOutside).length,
      onsite: clocked.filter((r) => r.isOnsite).length,
      remote: clocked.filter((r) => !r.isOnsite && r.clockInOutside).length,
    };
  }

  /**
   * Comp-off history: for each credit, the day worked and why it counted
   * (holiday, weekly off, rostered day off), the clock times, and the field
   * visit or project behind it — plus the comp-off leaves already taken.
   *
   * An employee sees their own; HR and admins anyone's, or a company-wide
   * summary when no employee is given. Balance beyond the recorded credits
   * (opening balances, manual additions) is shown as "added manually".
   */
  async getCompOffHistory(
    companyId: number,
    viewer: { role?: string | null; employeeId?: number | null },
    employeeId?: number | null,
    year?: number,
    /**
     * Optional date range (YYYY-MM-DD) from the Duration filter. Credits and
     * the days used are limited to it; the balance stays the one for the year
     * the range ends in, since balances are kept per year.
     */
    range: { from?: string; to?: string } = {},
  ) {
    const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if ((range.from || range.to) && !(isDay(range.from) && isDay(range.to))) {
      throw new BadRequestException('from and to must both be dates (YYYY-MM-DD)');
    }
    let from = isDay(range.from) ? new Date(`${range.from}T00:00:00.000Z`) : null;
    let to = isDay(range.to) ? new Date(`${range.to}T00:00:00.000Z`) : null;
    if (from && to && from > to) [from, to] = [to, from];
    const y = to ? to.getUTCFullYear() : year || new Date().getUTCFullYear();
    const hr = isHrAdmin(viewer.role);
    const target = employeeId ?? (hr ? null : viewer.employeeId ?? null);
    if (target != null && target !== viewer.employeeId && !hr) {
      throw new ForbiddenException('You can only see your own comp-off history');
    }
    if (target == null && !hr) throw new ForbiddenException('No employee profile');

    const leaveType = await this.prisma.leaveType.findFirst({ where: { companyId, isCompOff: true }, select: { id: true, name: true } });
    if (!leaveType) return { year: y, employees: [] };

    const employeeWhere: any = { companyId, ...(target != null ? { id: target } : {}) };
    const [balances, credits] = await Promise.all([
      this.prisma.leaveBalance.findMany({
        where: { leaveTypeId: leaveType.id, year: y, employee: employeeWhere },
        select: { employeeId: true, allocated: true, used: true },
      }),
      this.prisma.compOffCredit.findMany({
        // The balance year's credits (to work out what HR added by hand) plus
        // any in the range, which may reach into last year.
        where: {
          companyId, leaveTypeId: leaveType.id, ...(target != null ? { employeeId: target } : {}),
          ...(from && to ? { OR: [{ year: y }, { date: { gte: from, lte: to } }] } : { year: y }),
        },
        include: {
          attendance: {
            select: { clockIn: true, clockOut: true, isOnsite: true, status: true,
              project: { select: { name: true, key: true } }, shift: { select: { name: true } } },
          },
        },
        orderBy: { date: 'desc' },
      }),
    ]);

    const ids = [...new Set([...balances.map((b) => b.employeeId), ...credits.map((c) => c.employeeId)])];
    if (!ids.length) return { year: y, employees: [] };

    const dates = credits.map((c) => c.date).filter((d): d is Date => !!d);
    const [people, holidays, visits, usedLeaves] = await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { in: ids }, companyId },
        select: { id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true,
          department: { select: { name: true } }, designation: { select: { name: true } } },
      }),
      dates.length
        ? this.prisma.holiday.findMany({ where: { companyId, date: { in: dates } }, select: { name: true, date: true } })
        : Promise.resolve([] as { name: string; date: Date }[]),
      dates.length
        ? this.prisma.fieldVisitAttendance.findMany({
            where: { companyId, employeeId: { in: ids }, visitDate: { in: dates } },
            select: { employeeId: true, visitDate: true,
              request: { select: { id: true, requestNumber: true, location: true, project: { select: { name: true, key: true } } } } },
          })
        : Promise.resolve([] as any[]),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: { in: ids }, leaveTypeId: leaveType.id, status: 'APPROVED', deletedAt: null,
          ...(from && to
            ? { startDate: { lte: to }, endDate: { gte: from } }
            : { startDate: { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) } }) },
        select: { id: true, employeeId: true, startDate: true, endDate: true, isHalfDay: true, reason: true },
        orderBy: { startDate: 'desc' },
      }),
    ]);

    const day = (d: Date) => d.toISOString().slice(0, 10);
    const holidayOn = new Map(holidays.map((h) => [day(h.date), h.name]));
    const visitOn = new Map(visits.map((v: any) => [`${v.employeeId}|${day(v.visitDate)}`, v.request]));
    const reasonLabel = (c: any) => {
      const d = c.date ? day(c.date) : '';
      if (holidayOn.has(d)) return `Worked on a holiday (${holidayOn.get(d)})`;
      if (c.reason === 'WEEK_OFF') return 'Worked on weekly off';
      if (c.reason === 'HOLIDAY') return 'Worked on a holiday';
      if (c.date && new Date(c.date).getUTCDay() === 0) return 'Worked on Sunday';
      return 'Worked on a scheduled day off';
    };

    const employees = people.map((p) => {
      const b = balances.find((x) => x.employeeId === p.id);
      const all = credits.filter((c) => c.employeeId === p.id);
      // Earned this balance year, for the manual-credit sum; shown, for the range.
      const earned = all.filter((c) => c.year === y).reduce((s2, c) => s2 + (c.days || 0), 0);
      const shown = from && to ? all.filter((c) => c.date && c.date >= from! && c.date <= to!) : all;
      const mine = shown.map((c) => {
        const visit = c.date ? visitOn.get(`${p.id}|${day(c.date)}`) : null;
        return {
          id: c.id,
          date: c.date ? day(c.date) : null,
          days: c.days,
          reason: reasonLabel(c),
          creditedOn: c.createdAt,
          clockIn: c.attendance?.clockIn ?? null,
          clockOut: c.attendance?.clockOut ?? null,
          shift: c.attendance?.shift?.name ?? null,
          onsite: !!c.attendance?.isOnsite,
          project: c.attendance?.project ? `${c.attendance.project.name} (${c.attendance.project.key})` : null,
          fieldVisit: visit ? { id: visit.id, number: visit.requestNumber, location: visit.location,
            project: visit.project ? `${visit.project.name} (${visit.project.key})` : null } : null,
        };
      });
      const allocated = b?.allocated ?? earned;
      const used = b?.used ?? 0;
      return {
        employee: p,
        allocated, used, remaining: Math.round((allocated - used) * 100) / 100,
        earnedFromWork: mine.reduce((s2, c) => s2 + (c.days || 0), 0),
        addedManually: Math.max(0, Math.round((allocated - earned) * 100) / 100),
        credits: mine,
        used_leaves: usedLeaves.filter((l) => l.employeeId === p.id).map((l) => ({
          id: l.id, from: day(l.startDate), to: day(l.endDate), halfDay: l.isHalfDay, reason: l.reason,
        })),
      };
    }).sort((a, b) => b.remaining - a.remaining || a.employee.firstName.localeCompare(b.employee.firstName));

    return { year: y, from: from ? day(from) : null, to: to ? day(to) : null, leaveType: leaveType.name, employees };
  }

  async getPendingClockOuts(
    companyId: number, role?: string | null, employeeId?: number | null,
  ) {
    await this.assertMayApproveClockOut(companyId, role, employeeId);
    const rows = await this.prisma.attendance.findMany({
      where: {
        employee: { companyId },
        // Waiting for approval, plus (19 Oct 2026) older late or automatic
        // clock-outs that never entered the queue: they count as half days
        // until approved, so they need to be approvable.
        OR: [
          { clockOutApproval: CLOCK_OUT_APPROVAL.PENDING },
          {
            // Only recent ones: older months are paid and closed, and pulling
            // every historic auto clock-out in made this queue thousands long.
            date: { gte: UNQUEUED_CLOCKOUT_FROM },
            clockOutApproval: null, clockIn: { not: null },
            // A session still open is not here: it has to be clocked out first.
            clockOut: { not: null },
            OR: [{ clockOutReason: { not: null } }, { autoClockedOut: true }],
          },
        ],
      },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, avatarUrl: true,
            employeeCode: true, designation: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
          },
        },
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
        project: { select: { id: true, name: true, key: true } },
      },
      orderBy: { date: 'asc' },
    });
    if (!rows.length) return rows;

    // Where they were that day (19 Oct 2026): a field visit, on site for a
    // project, outside the office, or in the office, so the approver can judge.
    const visits = await this.prisma.fieldVisitAttendance.findMany({
      where: {
        companyId,
        employeeId: { in: [...new Set(rows.map((r) => r.employeeId))] },
        visitDate: { in: [...new Set(rows.map((r) => r.date.getTime()))].map((t) => new Date(t)) },
        request: { status: { in: ['APPROVED', 'IN_PROGRESS', 'COMPLETED'] } },
      },
      include: {
        request: { select: { id: true, requestNumber: true, location: true, project: { select: { id: true, name: true, key: true } } } },
      },
    });
    const visitByKey = new Map(visits.map((v) => [`${v.employeeId}_${v.visitDate.toISOString().slice(0, 10)}`, v]));
    return rows.map((r) => {
      const v = visitByKey.get(`${r.employeeId}_${r.date.toISOString().slice(0, 10)}`);
      const workType = v ? 'FIELD_VISIT' : r.isOnsite ? 'ON_SITE' : r.clockInOutside ? 'OUTSIDE' : 'OFFICE';
      return {
        ...r,
        workType,
        fieldVisit: v
          ? {
              requestId: v.request.id, requestNumber: v.request.requestNumber, location: v.request.location,
              project: v.request.project, clockInTime: v.clockInTime, clockOutTime: v.clockOutTime, status: v.status,
            }
          : null,
      };
    });
  }

  /**
   * Habitual late-comers: people clocked in late on `minLate` or more days in
   * the last `days` days, worst first. Shown to whoever may approve late
   * clock-outs — the same people who already see this queue.
   */
  async getLateOffenders(
    companyId: number, role?: string | null, employeeId?: number | null,
    days = 30, minLate = 5,
  ) {
    await this.assertMayApproveClockOut(companyId, role, employeeId);
    const span = Math.min(Math.max(Math.round(days) || 30, 1), 366);
    const threshold = Math.max(Math.round(minLate) || 5, 1);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (span - 1));

    const groups = await this.prisma.attendance.groupBy({
      by: ['employeeId'],
      where: { isLate: true, date: { gte: since }, employee: { companyId } },
      _count: { _all: true },
      _max: { date: true },
    });
    const hits = groups.filter((g) => g._count._all >= threshold);
    if (!hits.length) return { days: span, minLate: threshold, offenders: [] };

    const people = await this.prisma.employee.findMany({
      where: { id: { in: hits.map((g) => g.employeeId) }, companyId },
      select: {
        id: true, firstName: true, lastName: true, avatarUrl: true, employeeCode: true,
        designation: { select: { name: true } }, department: { select: { name: true } },
      },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    const offenders = hits
      .filter((g) => byId.has(g.employeeId))
      .map((g) => ({ employee: byId.get(g.employeeId)!, lateDays: g._count._all, lastLate: g._max.date }))
      .sort((a, b) => b.lateDays - a.lateDays);
    return { days: span, minLate: threshold, offenders };
  }

  /** What an employee is still waiting on, for their own attendance screen. */
  async getMyClockOutApprovals(userId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee profile not found');
    return this.prisma.attendance.findMany({
      where: { employeeId: employee.id, clockOutApproval: { not: null } },
      orderBy: { date: 'desc' },
      take: 50,
    });
  }

  /**
   * Rule on one late clock-out.
   *
   * A rejection must say why. An approval need not: "yes, that is what
   * happened" adds nothing, whereas a refusal the employee cannot read is a
   * decision they have no way to answer.
   */
  async reviewClockOut(
    companyId: number,
    attendanceId: number,
    data: { action: 'APPROVE' | 'REJECT'; note?: string },
    role?: string | null,
    approverEmployeeId?: number | null,
  ) {
    await this.assertMayApproveClockOut(companyId, role, approverEmployeeId);

    const record = await this.prisma.attendance.findFirst({
      where: { id: attendanceId, employee: { companyId } },
      include: { employee: { select: { id: true, userId: true, firstName: true } } },
    });
    if (!record) throw new BadRequestException('Attendance record not found');
    // Null too (19 Oct 2026): older late clock-outs that never entered the queue.
    if (record.clockOutApproval !== CLOCK_OUT_APPROVAL.PENDING && record.clockOutApproval !== null) {
      throw new BadRequestException(
        `This clock-out has already been ${String(record.clockOutApproval ?? 'settled').toLowerCase()}.`,
      );
    }

    // Nobody rules on their own forgotten clock-out, whatever list they are on.
    if (approverEmployeeId != null && record.employeeId === approverEmployeeId) {
      throw new ForbiddenException('You cannot approve your own clock-out.');
    }

    const rejecting = data.action === 'REJECT';
    const note = data.note?.trim() || '';
    if (rejecting && !note) {
      throw new BadRequestException('A rejection has to say why.');
    }

    const updated = await this.prisma.attendance.update({
      where: { id: record.id },
      data: {
        clockOutApproval: rejecting
          ? CLOCK_OUT_APPROVAL.REJECTED
          : CLOCK_OUT_APPROVAL.APPROVED,
        clockOutApprovedById: approverEmployeeId ?? null,
        clockOutApprovedAt: new Date(),
        clockOutReviewNote: note || null,
      },
      include: { logs: true },
    });

    if (!rejecting) await this.grantCompOffIfEligible(updated.id);

    await this.notificationsService.notifyEmployees([record.employeeId], {
      companyId,
      title: rejecting ? 'Clock-out rejected' : 'Clock-out approved',
      message: rejecting
        ? `Your clock-out for ${record.date.toISOString().slice(0, 10)} was rejected: ${note}`
        : `Your clock-out for ${record.date.toISOString().slice(0, 10)} was approved.`,
      type: 'ATTENDANCE',
      linkUrl: '/attendance/my',
      excludeEmployeeId: approverEmployeeId ?? null,
    });

    return this.withTotalHours(updated);
  }

  // ── Office geofence approvals (B3) ───────────────────────────────────────
  //
  // Super Admins and Admins rule on clock-ins and clock-outs made outside the
  // office radius. A rejection only flags the day — status, hours and pay are
  // left exactly as recorded; what to do about it is HR's call.

  mayApproveGeofence(role?: string | null): boolean {
    return isCompanyAdmin(role);
  }

  async getPendingGeofence(companyId: number, role?: string | null) {
    if (!this.mayApproveGeofence(role)) {
      throw new ForbiddenException('Only an administrator reviews out-of-office clock-ins and clock-outs.');
    }
    const rows = await this.prisma.attendance.findMany({
      where: { geofenceApproval: 'PENDING', employee: { companyId } },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, avatarUrl: true,
            employeeCode: true, designation: { select: { id: true, name: true } }, // the name, not the relation: the card printed [object Object]
            department: { select: { id: true, name: true } },
          },
        },
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
      orderBy: { date: 'asc' },
    });
    if (!rows.length || !this.prisma.leaveRequest?.findMany) return rows;
    // Days covered by an approved Work From Home request (19 Oct 2026), so the
    // approver sees at a glance that working away from the office was agreed.
    const days = rows.map((r) => r.date);
    const leaves = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: [...new Set(rows.map((r) => r.employeeId))] }, status: 'APPROVED', deletedAt: null,
        startDate: { lte: new Date(Math.max(...days.map((d) => d.getTime()))) },
        endDate: { gte: new Date(Math.min(...days.map((d) => d.getTime()))) },
      },
      select: { employeeId: true, startDate: true, endDate: true, leaveType: { select: { name: true } } },
    });
    const wfh = leaves.filter((l) => WFH_NAME.test(l.leaveType?.name ?? ''));
    const wfhReqs = this.prisma.wfhRequest?.findMany ? await this.prisma.wfhRequest.findMany({
      where: { employeeId: { in: [...new Set(rows.map((r) => r.employeeId))] }, status: 'APPROVED', date: { in: rows.map((r) => r.date) } },
      select: { employeeId: true, date: true },
    }) : [];
    const reqKey = new Set(wfhReqs.map((w) => `${w.employeeId}_${w.date.toISOString().slice(0, 10)}`));
    const profiles = await this.prisma.employee.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } },
      select: { id: true, workLocation: true, usualWorkLocation: true },
    });
    const profileBy = new Map(profiles.map((p) => [p.id, p]));
    return rows.map((r) => {
      const byRequest = reqKey.has(`${r.employeeId}_${r.date.toISOString().slice(0, 10)}`)
        || wfh.some((l) => l.employeeId === r.employeeId && l.startDate <= r.date && l.endDate >= r.date);
      const byProfile = !byRequest && profileSaysWfh(profileBy.get(r.employeeId) ?? null, r.date);
      return { ...r, approvedWfh: byRequest, profileWfh: byProfile };
    });
  }

  async reviewGeofence(
    companyId: number,
    attendanceId: number,
    data: { action: 'APPROVE' | 'REJECT'; note?: string },
    role?: string | null,
    approverEmployeeId?: number | null,
  ) {
    if (!this.mayApproveGeofence(role)) {
      throw new ForbiddenException('Only an administrator reviews out-of-office clock-ins and clock-outs.');
    }
    const record = await this.prisma.attendance.findFirst({
      where: { id: attendanceId, employee: { companyId } },
    });
    if (!record) throw new BadRequestException('Attendance record not found');
    if (record.geofenceApproval !== 'PENDING') {
      throw new BadRequestException(
        `This has already been ${String(record.geofenceApproval ?? 'settled').toLowerCase()}.`,
      );
    }
    // Two administrators exist to check each other; nobody clears their own.
    if (approverEmployeeId != null && record.employeeId === approverEmployeeId) {
      throw new ForbiddenException('Another administrator has to review your own out-of-office clock.');
    }

    const rejecting = data.action === 'REJECT';
    const note = data.note?.trim() || '';
    if (rejecting && !note) throw new BadRequestException('A rejection has to say why.');

    const updated = await this.prisma.attendance.update({
      where: { id: record.id },
      data: {
        geofenceApproval: rejecting ? 'REJECTED' : 'APPROVED',
        geofenceReviewedById: approverEmployeeId ?? null,
        geofenceReviewedAt: new Date(),
        geofenceReviewNote: note || null,
      },
      include: { logs: true },
    });

    const day = record.date.toISOString().slice(0, 10);
    await this.notificationsService.notifyEmployees([record.employeeId], {
      companyId,
      title: rejecting ? 'Out-of-office clock rejected' : 'Out-of-office clock approved',
      message: rejecting
        ? `Your clock-in/out away from the office on ${day} was rejected: ${note}`
        : `Your clock-in/out away from the office on ${day} was approved.`,
      type: 'ATTENDANCE',
      linkUrl: '/attendance/my',
      excludeEmployeeId: approverEmployeeId ?? null,
    });

    return this.withTotalHours(updated);
  }

  async getMyRegularizations(userId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee not found');
    return this.prisma.attendanceRegularization.findMany({
      where: { employeeId: employee.id },
      orderBy: { date: 'desc' }
    });
  }

  /**
   * The regularization queue, for whoever may decide it.
   *
   * It used to answer anybody, for the whole company, with every column of
   * every employee row. Now: HR and administrators see the company, a manager
   * sees the people below them in the reporting line, anyone else sees
   * nothing — and only the fields the queue shows are sent.
   */
  async getPendingRegularizations(companyId: number, role?: string | null, employeeId?: number | null, status?: string) {
    let scope: any = { companyId };
    if (!isHrAdmin(role)) {
      const team = employeeId ? await this.teamBelow(companyId, employeeId) : [];
      if (!team.length) return [];
      scope = { companyId, id: { in: team } };
    }
    // No status means the approval queue (PENDING) — the mobile app's
    // Approvals screen relies on that. ALL, APPROVED, REJECTED are opt-in.
    const wanted = (status || 'PENDING').toUpperCase();
    const where: any = { employee: scope };
    if (wanted !== 'ALL') where.status = wanted;
    return this.prisma.attendanceRegularization.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, avatarUrl: true, employeeCode: true, userId: true,
            designation: { select: { name: true } }, department: { select: { name: true } },
          },
        },
      },
      orderBy: { date: 'desc' }
    });
  }

  /** Everyone below this employee in the reporting line, any depth. */
  private async teamBelow(companyId: number, managerId: number): Promise<number[]> {
    const all: number[] = [];
    let frontier = [managerId];
    for (let depth = 0; frontier.length && depth < 15; depth++) {
      const next = await this.prisma.employee.findMany({
        where: { companyId, managerId: { in: frontier } }, select: { id: true },
      });
      frontier = next.map((e) => e.id).filter((id) => !all.includes(id) && id !== managerId);
      all.push(...frontier);
    }
    return all;
  }

  /** HR / admin for the company; a manager for their own team; never yourself. */
  private async assertMayDecideRegularization(
    companyId: number, role: string | null | undefined, approverEmployeeId: number | null | undefined,
    subject: { companyId: number; id: number },
  ) {
    if (subject.companyId !== companyId) throw new ForbiddenException('Not your company');
    if (approverEmployeeId && subject.id === approverEmployeeId) {
      throw new ForbiddenException('You cannot approve your own regularization.');
    }
    if (isHrAdmin(role)) return;
    const team = approverEmployeeId ? await this.teamBelow(companyId, approverEmployeeId) : [];
    if (!team.includes(subject.id)) {
      throw new ForbiddenException('Only HR, an administrator or their manager can decide this regularization.');
    }
  }

  /**
   * One regularization, or several days in one go.
   *
   * `entries` lets somebody who missed several days (three non-working days
   * worked, say) send them together rather than filling the form three times.
   * Each day is still its own row, so HR can approve one and reject another.
   * A plain { date, ... } body is the single-day form and behaves as before.
   */
  async requestRegularization(userId: number, data: {
    date?: string, proposedClockIn?: string, proposedClockOut?: string, reason: string,
    entries?: Array<{ date: string, proposedClockIn?: string, proposedClockOut?: string }>,
  }) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: { manager: { select: { userId: true } } },
    });
    if (!employee) throw new BadRequestException('Employee not found');

    const reason = String(data?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('Say why you are regularizing.');
    const entries = Array.isArray(data?.entries) && data.entries.length
      ? data.entries
      : [{ date: data?.date as string, proposedClockIn: data?.proposedClockIn, proposedClockOut: data?.proposedClockOut }];
    if (entries.length > 31) throw new BadRequestException('Up to 31 days can be sent in one request.');

    const days = entries.map((e) => {
      if (!e?.date || !/^\d{4}-\d{2}-\d{2}/.test(e.date)) throw new BadRequestException('Every day needs a date.');
      const inAt = e.proposedClockIn ? new Date(e.proposedClockIn) : null;
      const outAt = e.proposedClockOut ? new Date(e.proposedClockOut) : null;
      if ((inAt && isNaN(inAt.getTime())) || (outAt && isNaN(outAt.getTime()))) {
        throw new BadRequestException(`${e.date.slice(0, 10)}: the clock-in or clock-out time is not valid.`);
      }
      if (inAt && outAt && outAt <= inAt) {
        throw new BadRequestException(`${e.date.slice(0, 10)}: clock-out has to be after clock-in.`);
      }
      return { date: new Date(`${e.date.slice(0, 10)}T00:00:00.000Z`), inAt, outAt };
    });
    const keys = days.map((d) => d.date.getTime());
    if (new Set(keys).size !== keys.length) throw new BadRequestException('The same day is listed twice.');

    const createdAll = await this.prisma.$transaction(days.map((d) =>
      this.prisma.attendanceRegularization.create({
        data: { employeeId: employee.id, date: d.date, proposedClockIn: d.inAt, proposedClockOut: d.outAt, reason },
      }),
    ));
    const created = createdAll.length === 1 ? createdAll[0] : createdAll;
    const date = days[0].date;
    const when = days.length === 1
      ? date.toISOString().split('T')[0]
      : `${days.length} days (${days.map((d) => d.date.toISOString().slice(0, 10)).join(', ')})`;

    // The request lands in a queue nobody polls, so tell the approvers it exists.
    // Never let a notification failure roll back a saved request.
    const name = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() || 'An employee';
    await this.notificationsService
      .notifyApprovers({
        companyId: employee.companyId,
        roles: ['SUPERADMIN', 'ADMIN', 'HR'],
        managerUserId: employee.manager?.userId ?? null,
        excludeUserId: userId,
        title: 'Attendance Regularization Request',
        message: `${name} has requested a correction for ${when}.`,
        type: 'ACTION_REQUIRED',
        linkUrl: '/attendance/approvals',
      })
      .catch(() => { /* the request is saved; the alert is best-effort */ });

    return created;
  }

  /**
   * The status a regularized day earns from its corrected times, judged the way
   * a live clock-in and clock-out would have judged them: late past the shift
   * start plus buffer, HALF_DAY past the half-day boundary or for leaving before
   * the shift ends. The shift is the one in force that day — a roster entry
   * (an approved onsite stint) first, the standing shift otherwise.
   */
  private async scoreRegularizedDay(
    employeeId: number, companyId: number, date: Date, clockIn: Date | null, clockOut: Date | null,
  ): Promise<{ status: string; isLate: boolean; isEarlyLeave: boolean; shiftId: number | null }> {
    const effective = this.workingWindow(await this.roster.getEffectiveShift(employeeId, date));
    const onHoliday = effective.isDayOff || await this.isHoliday(companyId, date);
    const shiftId = effective.shift?.id ?? null;
    if (onHoliday) return { status: 'PRESENT', isLate: false, isEarlyLeave: false, shiftId };

    let isLate = false;
    let lateStartHalfDay = false;
    if (clockIn && effective.startTime) {
      const buffer = effective.shift?.bufferTimeMinutes ?? 0;
      isLate = clockIn.getTime() > istTimeInstant(clockIn, effective.startTime).getTime() + buffer * 60000;
      lateStartHalfDay = isHalfDayStart(clockIn, effective.startTime, effective.shift?.halfDayTime, istTimeInstant);
    }

    let isEarlyLeave = false;
    if (clockIn && clockOut && effective.endTime) {
      // Resolved on the clock-in's day so a session closed after midnight is
      // compared with the right shift end; an overnight shift ends the next day.
      let expectedEnd = istTimeInstant(clockIn, effective.endTime);
      if (effective.startTime && expectedEnd <= istTimeInstant(clockIn, effective.startTime)) {
        expectedEnd = new Date(expectedEnd.getTime() + 86_400_000);
      }
      isEarlyLeave = clockOut < expectedEnd;
    }

    return {
      status: lateStartHalfDay || isEarlyLeave ? 'HALF_DAY' : 'PRESENT',
      isLate, isEarlyLeave, shiftId,
    };
  }

  async resolveRegularization(
    id: number, approverUserId: number, status: string, rejectionReason?: string,
    actor?: { companyId: number; role?: string | null; employeeId?: number | null },
  ) {
    const regularization = await this.prisma.attendanceRegularization.findUnique({
      where: { id },
      include: { employee: true }
    });
    if (!regularization) throw new BadRequestException('Regularization not found');
    // Approving writes attendance and can credit comp-off, so it is checked
    // here, not left to whoever can reach the endpoint.
    if (!actor) throw new ForbiddenException('Not allowed');
    await this.assertMayDecideRegularization(actor.companyId, actor.role, actor.employeeId, regularization.employee);
    if (!['APPROVED', 'REJECTED'].includes(status)) throw new BadRequestException('Status must be APPROVED or REJECTED');
    if (regularization.status !== 'PENDING') throw new BadRequestException(`This request is already ${String(regularization.status).toLowerCase()}`);
    if (status === 'REJECTED' && !rejectionReason?.trim()) throw new BadRequestException('Say why it is rejected.');
    
    if (status === 'APPROVED') {
      const attendance = await this.prisma.attendance.findUnique({
        where: { employeeId_date: { employeeId: regularization.employeeId, date: regularization.date } }
      });
      const clockIn = regularization.proposedClockIn || attendance?.clockIn || null;
      const clockOut = regularization.proposedClockOut || attendance?.clockOut || null;
      // Approval used to rewrite the times and leave the status alone, so a day
      // scored HALF_DAY stayed HALF_DAY however it was corrected — Amit Kumar's
      // onsite days (3–9 Oct) were approved and still docked half a day each.
      // Score the corrected times against the day's real shift instead. A leave,
      // holiday or weekly-off row is not a worked-day score, so it is left as it was.
      const rescore = !attendance || ['PRESENT', 'HALF_DAY'].includes(String(attendance.status));
      const score = rescore
        ? await this.scoreRegularizedDay(regularization.employeeId, regularization.employee.companyId, regularization.date, clockIn, clockOut)
        : {};
      const saved = attendance
        ? await this.prisma.attendance.update({
          where: { id: attendance.id },
          data: { clockIn, clockOut, ...score }
        })
        : await this.prisma.attendance.create({
          data: {
            employeeId: regularization.employeeId,
            date: regularization.date,
            clockIn,
            clockOut,
            status: 'PRESENT',
            ...score,
          }
        });
      // A day worked on a Sunday, holiday or day off earns comp-off however it
      // got recorded. Only a live clock-out used to credit it, so somebody who
      // could not clock in that day and had it regularized got the day but not
      // the comp-off. Idempotent: one credit per attendance day.
      await this.grantCompOffIfEligible(saved.id);
    }
    
    const updated = await this.prisma.attendanceRegularization.update({
      where: { id },
      data: {
        status,
        rejectionReason,
        approvedById: approverUserId
      }
    });

    // Close the loop: the requester has no other way of learning the outcome.
    const requesterUserId = regularization.employee?.userId;
    if (requesterUserId && requesterUserId !== approverUserId) {
      const day = regularization.date.toISOString().split('T')[0];
      const label = status === 'APPROVED' ? 'approved' : 'rejected';
      await this.notificationsService
        .createNotification(
          requesterUserId,
          `Regularization ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
          rejectionReason
            ? `Your attendance correction for ${day} was ${label}: ${rejectionReason}`
            : `Your attendance correction for ${day} was ${label}.`,
          status === 'APPROVED' ? 'SUCCESS' : 'WARNING',
          '/attendance/attendance',
          regularization.employee.companyId,
        )
        .catch(() => { /* the decision is recorded; the alert is best-effort */ });
    }

    return updated;
  }

  async getTeamTimeline(companyId: number, startDateStr: string, endDateStr: string) {
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid start or end date');
    }

    if (startDate > endDate) {
      throw new BadRequestException('Start date cannot be after end date');
    }

    const employees = await this.prisma.employee.findMany({
      where: { companyId, user: { status: { not: 'SUSPENDED' } } },
      include: {
        department: true,
        designation: true,
        attendances: {
          where: {
            date: {
              gte: startDate,
              lte: endDate
            }
          }
        },
        leaveRequests: {
          where: {
            status: 'APPROVED',
            OR: [
              { startDate: { lte: endDate }, endDate: { gte: startDate } }
            ]
          }
        }
      }
    });

    return employees;
  }

  async getAllEmployeesAttendance(
    companyId: number,
    filters: {
      month?: number; year?: number; employeeId?: number; departmentId?: number;
      status?: string; from?: string; to?: string; all?: boolean;
    },
  ) {
    const now = new Date();
    const year = filters.year ?? now.getFullYear();
    const month = filters.month ?? now.getMonth() + 1; // 1-12, default current month

    let dateFilter: { gte?: Date; lte?: Date } | undefined;
    if (!filters.all) {
      if (filters.from || filters.to) {
        const from = filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : null;
        const to = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : null;
        if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime())) || (from && to && from > to)) {
          throw new BadRequestException('Attendance date range is invalid.');
        }
        dateFilter = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
      } else {
        dateFilter = {
          gte: new Date(Date.UTC(year, month - 1, 1)),
          lte: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
        };
      }
    }

    const where: any = {
      employee: { companyId },
    };
    if (dateFilter) where.date = dateFilter;
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.departmentId) where.employee = { companyId, departmentId: filters.departmentId };
    if (filters.status) where.status = filters.status;

    const records = await this.prisma.attendance.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            employeeCode: true,
            department: { select: { id: true, name: true } },
            designation: { select: { id: true, name: true } },
            user: { select: { email: true, role: true } },
            shift: { select: { id: true, name: true, workingDays: true } },
            branch: { select: { weeklyOffs: true } },
          },
        },
        project: {
          select: { id: true, name: true, key: true },
        },
        shift: {
          select: { id: true, name: true, startTime: true, endTime: true },
        },
        logs: {
          orderBy: { clockIn: 'asc' },
        },
      },
      orderBy: [{ date: 'desc' }, { employeeId: 'asc' }],
    });

    // Planned state belongs in the attendance matrix before the day arrives.
    // Attendance rows remain authoritative: a real clock-in always replaces a
    // planned leave/day-off marker for the same employee and day.
    const virtualRecords: any[] = [];
    if (dateFilter && !filters.all) {
      const employeeWhere: any = {
        companyId,
        ...(filters.employeeId ? { id: filters.employeeId } : {}),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      };
      const employeeSelect = {
        id: true, firstName: true, lastName: true, avatarUrl: true, employeeCode: true,
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        user: { select: { email: true, role: true } },
        shift: { select: { id: true, name: true, workingDays: true } },
        branch: { select: { weeklyOffs: true } },
      } as const;
      const rangeStart = dateFilter.gte ?? new Date('1970-01-01T00:00:00.000Z');
      const rangeEnd = dateFilter.lte ?? new Date('9999-12-31T23:59:59.999Z');
      const [approvedLeaves, rosterDaysOff] = await Promise.all([
        this.prisma.leaveRequest.findMany({
          where: {
            status: 'APPROVED', deletedAt: null, employee: employeeWhere,
            startDate: { lte: rangeEnd }, endDate: { gte: rangeStart },
          },
          include: { employee: { select: employeeSelect }, leaveType: { select: { name: true } } },
        }),
        this.prisma.shiftRosterEntry.findMany({
          where: { companyId, isDayOff: true, date: dateFilter, employee: employeeWhere },
          include: { employee: { select: employeeSelect } },
        }),
      ]);

      const actualDays = new Set(records.map((row) => `${row.employeeId}_${row.date.toISOString().slice(0, 10)}`));
      const markerDays = new Map<string, any>();
      for (const row of rosterDaysOff) {
        const key = `${row.employeeId}_${row.date.toISOString().slice(0, 10)}`;
        if (!actualDays.has(key)) markerDays.set(key, {
          id: -row.id, employeeId: row.employeeId, date: row.date, status: 'WEEKLY_OFF',
          clockIn: null, clockOut: null, isLate: false, isEarlyLeave: false, employee: row.employee,
          // The client must distinguish this explicit roster override from a
          // historic WEEKLY_OFF attendance row created under an old schedule.
          isRosteredDayOff: true,
        });
      }
      // Leave is more informative than a coincident planned day off, so it
      // intentionally overwrites the roster marker. A real attendance row
      // above still wins over both.
      for (const leave of approvedLeaves) {
        const start = new Date(Math.max(leave.startDate.getTime(), rangeStart.getTime()));
        const end = new Date(Math.min(leave.endDate.getTime(), rangeEnd.getTime()));
        for (let day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
          const key = `${leave.employeeId}_${day.toISOString().slice(0, 10)}`;
          if (!actualDays.has(key)) markerDays.set(key, {
            id: -(100000000 + leave.id), employeeId: leave.employeeId, date: new Date(day), status: 'ON_LEAVE',
            clockIn: null, clockOut: null, isLate: false, isEarlyLeave: false, employee: leave.employee,
            leaveType: leave.leaveType?.name, isHalfDay: leave.isHalfDay,
          });
        }
      }
      virtualRecords.push(...markerDays.values());
    }

    const fieldVisitWhere: any = {
      companyId,
      request: { status: { in: ['APPROVED', 'IN_PROGRESS', 'COMPLETED'] } },
    };
    if (dateFilter) fieldVisitWhere.visitDate = dateFilter;
    const fieldVisits = await this.prisma.fieldVisitAttendance.findMany({
      where: fieldVisitWhere,
      include: {
        request: {
          select: {
            id: true,
            requestNumber: true,
            location: true,
            startTime: true,
            endTime: true,
            project: { select: { id: true, name: true, key: true } },
          },
        },
        employee: {
          select: {
            id: true, firstName: true, lastName: true, avatarUrl: true, employeeCode: true,
            department: { select: { id: true, name: true } },
            designation: { select: { id: true, name: true } },
            user: { select: { email: true, role: true } },
            shift: { select: { id: true, name: true, workingDays: true } },
            branch: { select: { weeklyOffs: true } },
          },
        },
      },
    });

    const fvByEmpDate = new Map<string, typeof fieldVisits[0]>();
    for (const fv of fieldVisits) {
      const dKey = fv.visitDate.toISOString().slice(0, 10);
      fvByEmpDate.set(`${fv.employeeId}_${dKey}`, fv);
    }

    // A field-visit assignment is planned attendance too. Add a display-only
    // record when the person has not clocked in yet, so the same approved visit
    // is visible in both the roster and the attendance matrix. A real
    // attendance row always wins once they clock in.
    const attendanceKeys = new Set(
      [...records, ...virtualRecords].map((row: any) => `${row.employeeId}_${row.date.toISOString().slice(0, 10)}`),
    );
    for (const fv of fieldVisits) {
      const key = `${fv.employeeId}_${fv.visitDate.toISOString().slice(0, 10)}`;
      if (attendanceKeys.has(key)) continue;
      virtualRecords.push({
        id: -(200000000 + fv.id), employeeId: fv.employeeId, date: fv.visitDate,
        status: 'PRESENT', clockIn: null, clockOut: null, isLate: false, isEarlyLeave: false,
        isOnsite: true, employee: fv.employee,
      });
      attendanceKeys.add(key);
    }

    const enhancedRecords = [...records, ...virtualRecords].map((r) => {
      const dKey = r.date.toISOString().slice(0, 10);
      const fv = fvByEmpDate.get(`${r.employeeId}_${dKey}`);
      if (fv) {
        return {
          ...r,
          fieldVisit: {
            requestId: fv.request.id,
            requestNumber: fv.request.requestNumber,
            location: fv.request.location,
            startTime: fv.request.startTime,
            endTime: fv.request.endTime,
            projectName: fv.request.project?.name,
            projectKey: fv.request.project?.key,
            status: fv.status,
          },
        };
      }
      if (r.isOnsite) {
        return {
          ...r,
          fieldVisit: {
            location: 'On-site',
            projectName: r.project?.name,
            projectKey: r.project?.key,
          },
        };
      }
      return r;
    });

    return enhancedRecords;
  }
  /**
   * Attendance grouped by shift, for a week or a month (§Att7).
   *
   * One query rather than one per shift: a company with eight shifts over a
   * month is eight round trips that all read the same table, and the totals
   * have to agree with each other anyway.
   *
   * Days with no shift recorded are reported under their own heading rather
   * than dropped. Attendance.shiftId is nullable and every row written before
   * shifts existed has it null, so silently excluding them would make a
   * per-shift summary quietly disagree with the headline attendance figures
   * somebody has open in the next tab.
   */
  async getShiftPeriodSummary(
    companyId: number,
    period: ShiftPeriod,
    anchorDate?: string,
    from?: string,
    to?: string,
    employeeQuery?: string,
  ) {
    const anchor = anchorDate ? new Date(`${anchorDate}T12:00:00`) : new Date();
    if (Number.isNaN(anchor.getTime())) {
      throw new BadRequestException('That date could not be read.');
    }
    const range = from || to
      ? (() => {
          if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            throw new BadRequestException('Provide a valid start and end date.');
          }
          const start = new Date(`${from}T00:00:00`);
          const end = new Date(`${to}T23:59:59.999`);
          const localDateKey = (date: Date) =>
            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end
              || localDateKey(start) !== from || localDateKey(end) !== to) {
            throw new BadRequestException('The date range is invalid.');
          }
          return {
            from: start,
            to: end,
            label: `${from} – ${to}`,
          };
        })()
      : resolvePeriod(period, anchor);

    const query = employeeQuery?.trim();
    const numericId = query && /^\d+$/.test(query) ? Number(query) : null;
    const employeeWhere = query
      ? {
          companyId,
          OR: [
            { firstName: { contains: query, mode: 'insensitive' as const } },
            { lastName: { contains: query, mode: 'insensitive' as const } },
            { employeeCode: { contains: query, mode: 'insensitive' as const } },
            ...(numericId ? [{ id: numericId }] : []),
          ],
        }
      : { companyId };

    const rows = await this.prisma.attendance.findMany({
      where: {
        employee: employeeWhere,
        date: { gte: range.from, lte: range.to },
      },
      select: {
        shiftId: true, status: true, isLate: true, isEarlyLeave: true,
        clockIn: true, clockOut: true, employeeId: true,
        shift: { select: { id: true, name: true, shortCode: true, colorCode: true } },
      },
    });

    type Bucket = {
      shiftId: number | null; name: string; shortCode: string | null; colorCode: string | null;
      present: number; halfDay: number; absent: number; onLeave: number; weeklyOff: number; holiday: number;
      late: number; earlyLeave: number; hours: number;
      employeeIds: Set<number>;
    };

    const buckets = new Map<number | null, Bucket>();
    const bucketFor = (r: typeof rows[number]): Bucket => {
      const key = r.shiftId ?? null;
      let b = buckets.get(key);
      if (!b) {
        b = {
          shiftId: key,
          name: r.shift?.name ?? 'No shift recorded',
          shortCode: r.shift?.shortCode ?? null,
          colorCode: r.shift?.colorCode ?? null,
          present: 0, halfDay: 0, absent: 0, onLeave: 0, weeklyOff: 0, holiday: 0,
          late: 0, earlyLeave: 0, hours: 0,
          employeeIds: new Set<number>(),
        };
        buckets.set(key, b);
      }
      return b;
    };

    for (const r of rows) {
      const b = bucketFor(r);
      b.employeeIds.add(r.employeeId);

      switch (r.status) {
        case 'HALF_DAY': b.halfDay++; break;
        case 'ABSENT': b.absent++; break;
        case 'ON_LEAVE': b.onLeave++; break;
        case 'WEEKLY_OFF': b.weeklyOff++; break;
        case 'HOLIDAY': b.holiday++; break;
        default: b.present++; break;
      }

      if (r.isLate) b.late++;
      if (r.isEarlyLeave) b.earlyLeave++;

      // Only a closed session has a duration. An open one is still running,
      // and guessing its end would put hours nobody has worked into a total
      // somebody may be paid from.
      if (r.clockIn && r.clockOut) {
        const mins = (new Date(r.clockOut).getTime() - new Date(r.clockIn).getTime()) / 60000;
        if (mins > 0) b.hours += mins / 60;
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const shifts = [...buckets.values()]
      .map(({ employeeIds, ...b }) => ({
        ...b,
        hours: round(b.hours),
        people: employeeIds.size,
        /** Days anybody was expected: the denominator for "how did this shift do". */
        workingDays: b.present + b.halfDay + b.absent,
      }))
      // Named shifts first, biggest by headcount; "No shift recorded" last,
      // because it is a data gap rather than a shift anybody works.
      .sort((a, b) => {
        if ((a.shiftId === null) !== (b.shiftId === null)) return a.shiftId === null ? 1 : -1;
        return b.people - a.people;
      });

    return {
      period,
      from: `${range.from.getFullYear()}-${String(range.from.getMonth() + 1).padStart(2, '0')}-${String(range.from.getDate()).padStart(2, '0')}`,
      to: `${range.to.getFullYear()}-${String(range.to.getMonth() + 1).padStart(2, '0')}-${String(range.to.getDate()).padStart(2, '0')}`,
      label: range.label,
      days: datesInRange(range).length,
      shifts,
      totals: {
        present: shifts.reduce((n, s) => n + s.present, 0),
        halfDay: shifts.reduce((n, s) => n + s.halfDay, 0),
        absent: shifts.reduce((n, s) => n + s.absent, 0),
        onLeave: shifts.reduce((n, s) => n + s.onLeave, 0),
        late: shifts.reduce((n, s) => n + s.late, 0),
        hours: round(shifts.reduce((n, s) => n + s.hours, 0)),
      },
    };
  }

}
