import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { istDateKey, istTimeInstant } from '../common/timezone.util';
import { LateClockOutError, OpenSessionError, OutsideOfficeError } from './open-session.error';
import { haversineKm } from '../common/geo.util';
import { FIELD_VISIT_STATUS, FIELD_VISIT_DAY } from '../field-visits/field-visit-status';
import { NotificationsService } from '../notifications/notifications.service';
import { ShiftRosterService, EffectiveShift } from './shift-roster.service';
import { ShiftPeriod, resolvePeriod, datesInRange } from './shift-period-summary';
import { CLOCK_OUT_APPROVAL } from './clock-out-approval';
import { isHalfDayStart } from './half-day-rule';
import { ApprovalsService } from '../approvals/approvals.service';
import { APPROVAL_WORKFLOW } from '../approvals/approval-workflows';
import { isCompanyAdmin, isHrAdmin } from '../common/company-roles';
import { isBranchWeeklyOff } from '../common/weekly-offs';

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
    const isSunday = date.getUTCDay() === 0;
    const weeklyOff = isBranchWeeklyOff(date, attendance.employee.branch?.weeklyOffs);
    const holiday = await this.isHoliday(attendance.employee.companyId, date);
    const effective = await this.roster.getEffectiveShift(
      attendance.employeeId,
      date,
      attendance.employee.shift,
      attendance.employee.branch?.weeklyOffs ?? '',
    );
    if (!isSunday && !weeklyOff && !effective.isDayOff && !holiday) return;

    const companyId = attendance.employee.companyId;
    const year = date.getUTCFullYear();
    let leaveType = await this.prisma.leaveType.findFirst({
      where: { companyId, name: { equals: 'Comp Off', mode: 'insensitive' } },
    });
    if (!leaveType) {
      leaveType = await this.prisma.leaveType.create({
        data: {
          companyId, name: 'Comp Off', description: 'Automatically credited for working on a Sunday or scheduled day off.',
          defaultDays: 0, accrualFrequency: 'NONE', accrualAmount: 0, isPaid: true, allowHalfDay: false,
        },
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Re-check inside the transaction for normal sequential requests.
        const credited = await tx.compOffCredit.findUnique({ where: { attendanceId } });
        if (credited) return;
        await tx.compOffCredit.create({
          data: { attendanceId, employeeId: attendance.employeeId, leaveTypeId: leaveType.id, year },
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

    return this.prisma.attendance.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: today
        }
      },
      include: { logs: true }
    }).then(r => this.withTotalHours(r));
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
    overtimeHours: true,
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
    data: { lat?: number, lng?: number, ipAddress?: string, outsideReason?: string, outsideProofUrl?: string },
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
    const effective = await this.roster.getEffectiveShift(
      employee.id, todayKey, employee.shift, employee.branch ? employee.branch.weeklyOffs ?? '' : null,
    );

    // A field visit day may also be clocked from here (TKT-029). Late and
    // half-day are still measured against the visit's own hours, because the
    // roster entry the approval wrote carries them. The visit's day record is
    // opened alongside, with how far from the site they were.
    const unopenedVisitDay = options?.fieldVisit ? null : await this.prisma.fieldVisitAttendance.findFirst({
      where: {
        employeeId: employee.id,
        visitDate: todayKey,
        clockInTime: null,
        request: { status: FIELD_VISIT_STATUS.APPROVED },
      },
      select: { id: true, request: { select: { latitude: true, longitude: true } } },
    });

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

    // 2. Office geofence (B3) — see officeCheck.
    const office = await this.officeCheck(employee, effective, onsite, data);
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
        status: existing.status === 'HALF_DAY' || isHalfDay ? 'HALF_DAY' : 'PRESENT',
        isLate: existing.isLate || isLate,
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
   * The office geofence (B3).
   *
   * Applies only when the day's shift is an office shift (Shift.officeGeofence,
   * i.e. General Shift) and the day is not on-site or a field visit. Within the
   * branch radius is ordinary; outside it — or with no location at all — is
   * allowed but must carry a reason, and is then reviewed by an administrator.
   *
   * The pin is the employee's branch, or the company's first branch with
   * coordinates for someone with no branch set. No coordinates anywhere means
   * no check, exactly as before.
   */
  private async officeCheck(
    employee: { companyId: number; branch?: any },
    effective: EffectiveShift,
    exempt: boolean,
    data: { lat?: number; lng?: number },
  ): Promise<{ outside: boolean; distanceKm: number | null; branchName: string; radiusM: number } | null> {
    if (exempt || !effective.shift?.officeGeofence) return null;

    const hasPin = (b: any) => b && b.latitude != null && b.longitude != null && b.geofenceRadius;
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
    return { outside: distanceKm * 1000 > radiusM, distanceKm, branchName: branch.name, radiusM };
  }

  /** The Attendance fields one outside-office clock writes, or none. */
  private outsideFields(
    direction: 'in' | 'out',
    office: { outside: boolean; distanceKm: number | null; branchName: string; radiusM: number } | null,
    data: { outsideReason?: string; outsideProofUrl?: string },
  ): Record<string, any> {
    if (!office?.outside) return {};
    const reason = String(data.outsideReason ?? '').trim();
    if (!reason) {
      throw new OutsideOfficeError(direction, office.branchName, office.distanceKm, office.radiusM);
    }
    const proof = String(data.outsideProofUrl ?? '').trim() || null;
    const km = office.distanceKm == null ? null : Math.round(office.distanceKm * 100) / 100;
    return {
      ...(direction === 'in'
        ? { clockInOutside: true, clockInDistanceKm: km, clockInOutsideReason: reason, clockInOutsideProofUrl: proof }
        : { clockOutOutside: true, clockOutDistanceKm: km, clockOutOutsideReason: reason, clockOutOutsideProofUrl: proof }),
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
      lat?: number, lng?: number, reason?: string, proofUrl?: string,
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
    const isPreviousDay = existing.date.getTime() < todayKey.getTime();

    const reason = (data?.reason ?? '').trim();
    if (isPreviousDay && !reason) {
      throw new LateClockOutError(existing.date);
    }

    const effective = await this.roster.getEffectiveShift(
      employee.id, existing.date, employee.shift, employee.branch ? employee.branch.weeklyOffs ?? '' : null,
    );

    // Office geofence (B3), on the same on-site exemption as clock-in — and
    // skipped entirely for a previous day. Someone closing Monday's session at
    // one in the morning is at home; that case has its own reason flow above.
    const officeOut = await this.officeCheck(
      employee, effective, isPreviousDay || !!effective.onsite || !!options?.fieldVisit, data,
    );
    const outsideOut = this.outsideFields('out', officeOut, data);

    let isEarlyLeave = false;
    let status = 'PRESENT';
    let overtimeHours = 0;

    // Scored only for a session closed on its own day. For a previous day the
    // gap between the shift ending and someone remembering is not work, and
    // paying overtime on it would reward forgetting; leaving the day at PRESENT
    // with a reason attached is the honest record, and regularization is how
    // the real hours get corrected.
    const onHoliday = await this.isHoliday(employee.companyId, existing.date) || effective.isDayOff;
    if (!isPreviousDay && effective.endTime && !onHoliday) {
      // Same IST-fixed resolution as clockIn — see the comment there.
      const expectedEnd = istTimeInstant(now, effective.endTime);

      if (now < expectedEnd) {
        isEarlyLeave = true;
        status = 'HALF_DAY';
      } else {
        const diffMs = now.getTime() - expectedEnd.getTime();
        if (diffMs > 30 * 60000) {
          overtimeHours = parseFloat((diffMs / 3600000).toFixed(2));
        }
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
        overtimeHours,
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
  async getPendingClockOuts(
    companyId: number, role?: string | null, employeeId?: number | null,
  ) {
    await this.assertMayApproveClockOut(companyId, role, employeeId);
    return this.prisma.attendance.findMany({
      where: {
        clockOutApproval: CLOCK_OUT_APPROVAL.PENDING,
        employee: { companyId },
      },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, avatarUrl: true,
            employeeCode: true, designation: true,
            department: { select: { id: true, name: true } },
          },
        },
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
      orderBy: { date: 'asc' },
    });
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
    if (record.clockOutApproval !== CLOCK_OUT_APPROVAL.PENDING) {
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
    return this.prisma.attendance.findMany({
      where: { geofenceApproval: 'PENDING', employee: { companyId } },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, avatarUrl: true,
            employeeCode: true, designation: true,
            department: { select: { id: true, name: true } },
          },
        },
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
      orderBy: { date: 'asc' },
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

  async getPendingRegularizations(companyId: number) {
    return this.prisma.attendanceRegularization.findMany({
      where: { employee: { companyId }, status: 'PENDING' },
      include: { employee: true },
      orderBy: { date: 'desc' }
    });
  }

  async requestRegularization(userId: number, data: { date: string, proposedClockIn?: string, proposedClockOut?: string, reason: string }) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: { manager: { select: { userId: true } } },
    });
    if (!employee) throw new BadRequestException('Employee not found');
    const date = new Date(data.date);
    const created = await this.prisma.attendanceRegularization.create({
      data: {
        employeeId: employee.id,
        date,
        proposedClockIn: data.proposedClockIn ? new Date(data.proposedClockIn) : null,
        proposedClockOut: data.proposedClockOut ? new Date(data.proposedClockOut) : null,
        reason: data.reason
      }
    });

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
        message: `${name} has requested a correction for ${date.toISOString().split('T')[0]}.`,
        type: 'ACTION_REQUIRED',
        linkUrl: '/attendance/approvals',
      })
      .catch(() => { /* the request is saved; the alert is best-effort */ });

    return created;
  }

  async resolveRegularization(id: number, approverUserId: number, status: string, rejectionReason?: string) {
    const regularization = await this.prisma.attendanceRegularization.findUnique({
      where: { id },
      include: { employee: true }
    });
    if (!regularization) throw new BadRequestException('Regularization not found');
    
    if (status === 'APPROVED') {
      const attendance = await this.prisma.attendance.findUnique({
        where: { employeeId_date: { employeeId: regularization.employeeId, date: regularization.date } }
      });
      if (attendance) {
        await this.prisma.attendance.update({
          where: { id: attendance.id },
          data: {
            clockIn: regularization.proposedClockIn || attendance.clockIn,
            clockOut: regularization.proposedClockOut || attendance.clockOut
          }
        });
      } else {
        await this.prisma.attendance.create({
          data: {
            employeeId: regularization.employeeId,
            date: regularization.date,
            clockIn: regularization.proposedClockIn,
            clockOut: regularization.proposedClockOut,
            status: 'PRESENT'
          }
        });
      }
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
      where: { companyId },
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
      },
    });

    const fvByEmpDate = new Map<string, typeof fieldVisits[0]>();
    for (const fv of fieldVisits) {
      const dKey = fv.visitDate.toISOString().slice(0, 10);
      fvByEmpDate.set(`${fv.employeeId}_${dKey}`, fv);
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
        clockIn: true, clockOut: true, overtimeHours: true, employeeId: true,
        shift: { select: { id: true, name: true, shortCode: true, colorCode: true } },
      },
    });

    type Bucket = {
      shiftId: number | null; name: string; shortCode: string | null; colorCode: string | null;
      present: number; halfDay: number; absent: number; onLeave: number; weeklyOff: number; holiday: number;
      late: number; earlyLeave: number; hours: number; overtimeHours: number;
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
          late: 0, earlyLeave: 0, hours: 0, overtimeHours: 0,
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
      b.overtimeHours += r.overtimeHours || 0;

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
        overtimeHours: round(b.overtimeHours),
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
