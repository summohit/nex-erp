import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { istDateKey, istTimeInstant } from '../common/timezone.util';
import { LateClockOutError, OpenSessionError } from './open-session.error';
import { haversineKm } from '../common/geo.util';
import { FIELD_VISIT_STATUS } from '../field-visits/field-visit-status';
import { NotificationsService } from '../notifications/notifications.service';
import { ShiftRosterService, EffectiveShift } from './shift-roster.service';

/**
 * What the field visit clock tells attendance about the day it is clocking.
 * Its presence is also the assertion that the site geofence has already been
 * applied — see `assertNotOnFieldVisit`.
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
  ) {}

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
   * Refuse the office clock when the day belongs to an approved field visit.
   *
   * Not a formality. The roster entry that approval writes marks the day
   * on-site, and an on-site day skips both the branch IP check and the branch
   * geofence — so without this, walking in through the ordinary clock-in is a
   * way to clock a field visit day from anywhere at all, which is exactly what
   * the 500m rule exists to prevent. Sending them to the field visit screen
   * also gets the day recorded against the task they were there to do.
   */
  private async assertNotOnFieldVisit(
    employeeId: number, dateKey: Date, direction: 'in' | 'out',
  ): Promise<void> {
    const day = await this.prisma.fieldVisitAttendance.findFirst({
      where: {
        employeeId,
        visitDate: dateKey,
        request: { status: FIELD_VISIT_STATUS.APPROVED },
      },
      select: { request: { select: { requestNumber: true, location: true } } },
    });
    if (!day) return;

    throw new BadRequestException(
      `You are on field visit ${day.request.requestNumber} at ${day.request.location} today.`
      + ` Clock ${direction} from the Field Visit screen so your site attendance is recorded.`,
    );
  }

  /**
   * `options.fieldVisit` marks a clock-in that came through the field visit
   * screen, which has already measured the person against the approved site.
   * Nothing else may set it — see `assertNotOnFieldVisit` below.
   */
  async clockIn(
    userId: number,
    data: { lat?: number, lng?: number, ipAddress?: string },
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
    const effective = await this.roster.getEffectiveShift(employee.id, todayKey, employee.shift);

    // A day on an approved field visit is clocked from the field visit screen,
    // which measures the person against the site's own 500m radius. Coming in
    // here instead would skip that check entirely, because the roster entry the
    // approval wrote marks the day on-site and on-site days are exempt from the
    // branch geofence — so the office clock-in is the bypass, and this closes it.
    if (!options?.fieldVisit) {
      await this.assertNotOnFieldVisit(employee.id, todayKey, 'in');
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

      // 2. Geofencing Check — only enforced once an admin has actually set the
      // branch's coordinates; branches without them behave as before (no check).
      // Also skipped on-site, for the same reason: someone rostered to a client
      // site is by definition outside the branch radius, and enforcing it would
      // make an on-site day impossible to clock at all.
      if (!onsite && branch.latitude != null && branch.longitude != null && branch.geofenceRadius) {
        if (data.lat == null || data.lng == null) {
          throw new BadRequestException('Location is required to clock in at this branch.');
        }
        const distanceKm = haversineKm(branch.latitude, branch.longitude, data.lat, data.lng);
        const radiusKm = branch.geofenceRadius / 1000;
        if (distanceKm > radiusKm) {
          throw new BadRequestException(
            `You're ${distanceKm.toFixed(2)}km from ${branch.name}, outside the ${radiusKm.toFixed(2)}km clock-in radius.`,
          );
        }
      }
    }

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
    if (effective.startTime) {
      // Shift times ("09:00") are IST wall-clock, not server-local — istTimeInstant
      // resolves them to the correct real-world instant regardless of what
      // timezone this server's OS happens to be configured with.
      const expectedStart = istTimeInstant(now, effective.startTime);
      const maxStartTime = new Date(expectedStart.getTime() + buffer * 60000);

      if (now > maxStartTime) {
        isLate = true;
      }

      // Clocking in past the shift's half-day boundary is more than late — the
      // day reads as a half day from the start.
      if (effective.shift?.halfDayTime && now > istTimeInstant(now, effective.shift.halfDayTime)) {
        isHalfDay = true;
      }
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
        },
        include: { logs: true }
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

    return this.prisma.attendance.update({
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
      },
      include: { logs: true }
    }).then(r => this.withTotalHours(r));
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
   */
  private async findOpenSessionBefore(employeeId: number, beforeDate: Date) {
    return this.prisma.attendance.findFirst({
      where: { employeeId, date: { lt: beforeDate }, logs: { some: { clockOut: null } } },
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
    data: { lat?: number, lng?: number, reason?: string },
    options?: { fieldVisit?: FieldVisitClockContext },
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: { shift: true, branch: true }
    });
    if (!employee) throw new BadRequestException('Employee profile not found');

    const now = new Date();
    const todayKey = istDateKey(now);

    // Same reasoning as clock-in: the way out of a field visit day is measured
    // against the site, not the office.
    if (!options?.fieldVisit) {
      await this.assertNotOnFieldVisit(employee.id, todayKey, 'out');
    }

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

    const effective = await this.roster.getEffectiveShift(employee.id, existing.date, employee.shift);

    const branch = employee.branch;
    // Geofence, on the same on-site exemption as clock-in — and skipped
    // entirely for a previous day. Someone closing Monday's session at one in
    // the morning is at home, and enforcing the office radius would leave the
    // session permanently unclosable, which is the one outcome worse than an
    // imprecise location.
    if (!isPreviousDay && !effective.onsite && !options?.fieldVisit && branch && branch.latitude != null && branch.longitude != null && branch.geofenceRadius) {
      if (data.lat == null || data.lng == null) {
        throw new BadRequestException('Location is required to clock out at this branch.');
      }
      const distanceKm = haversineKm(branch.latitude, branch.longitude, data.lat, data.lng);
      const radiusKm = branch.geofenceRadius / 1000;
      if (distanceKm > radiusKm) {
        throw new BadRequestException(
          `You're ${distanceKm.toFixed(2)}km from ${branch.name}, outside the ${radiusKm.toFixed(2)}km clock-out radius.`,
        );
      }
    }

    let isEarlyLeave = false;
    let status = 'PRESENT';
    let overtimeHours = 0;

    // Scored only for a session closed on its own day. For a previous day the
    // gap between the shift ending and someone remembering is not work, and
    // paying overtime on it would reward forgetting; leaving the day at PRESENT
    // with a reason attached is the honest record, and regularization is how
    // the real hours get corrected.
    if (!isPreviousDay && effective.endTime) {
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

    return this.prisma.attendance.update({
      where: { id: existing.id },
      data: {
        clockOut: now,
        clockOutLat: data.lat, // We can track the latest clock out coords here too
        clockOutLng: data.lng,
        isEarlyLeave,
        status,
        overtimeHours,
        autoClockedOut: false,
        // The reason is the permanent record that this day's clock-out time is
        // a closure rather than an observation. `missedClockOut` is the live
        // "still open and overdue" state and is spent the moment it closes.
        ...(isPreviousDay ? { clockOutReason: reason } : {}),
        missedClockOut: false,
      },
      include: { logs: true }
    }).then(r => this.withTotalHours(r));
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
    filters: { month?: number; year?: number; employeeId?: number; departmentId?: number; status?: string },
  ) {
    const now = new Date();
    const year = filters.year ?? now.getFullYear();
    const month = filters.month ?? now.getMonth() + 1; // 1-12, default current month

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const where: any = {
      date: { gte: startDate, lte: endDate },
      employee: { companyId },
    };
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
        logs: {
          orderBy: { clockIn: 'asc' },
        },
      },
      orderBy: [{ date: 'desc' }, { employeeId: 'asc' }],
    });

    return records;
  }
}
