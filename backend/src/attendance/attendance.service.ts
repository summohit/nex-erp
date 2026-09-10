import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { istDateKey, istTimeInstant } from '../common/timezone.util';
import { haversineKm } from '../common/geo.util';
import { NotificationsService } from '../notifications/notifications.service';
import { ShiftRosterService, EffectiveShift } from './shift-roster.service';

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
    logs: {
      select: {
        id: true,
        clockIn: true,
        clockOut: true,
        clockInLat: true,
        clockInLng: true,
        clockOutLat: true,
        clockOutLng: true,
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

  async clockIn(userId: number, data: { lat?: number, lng?: number, ipAddress?: string }) {
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
    const onsite = !!effective.onsite;

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
    }

    if (!existing) {
      existing = await this.prisma.attendance.create({
        data: {
          employeeId: employee.id,
          date: todayKey,
          clockIn: now,
          clockInLat: data.lat,
          clockInLng: data.lng,
          status: 'PRESENT',
          isLate,
          shiftId: effective.shift?.id ?? null,
          projectId: effective.onsite?.projectId ?? null,
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
        status: existing.status === 'HALF_DAY' ? 'HALF_DAY' : 'PRESENT',
        isLate: existing.isLate || isLate,
        clockOut: null, // Reset clockOut on parent since they are active
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

  async clockOut(userId: number, data: { lat?: number, lng?: number }) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: { shift: true, branch: true }
    });
    if (!employee) throw new BadRequestException('Employee profile not found');

    const nowForDay = new Date();
    const todayKey = istDateKey(nowForDay);
    const effective = await this.roster.getEffectiveShift(employee.id, todayKey, employee.shift);

    const branch = employee.branch;
    // Same on-site exemption as clock-in — otherwise someone could clock in at
    // a client site and then be unable to clock out.
    if (!effective.onsite && branch && branch.latitude != null && branch.longitude != null && branch.geofenceRadius) {
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

    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: todayKey } },
      include: { logs: true }
    });

    if (!existing || !existing.clockIn) {
      throw new BadRequestException('You must clock in first');
    }

    const activeLog = existing.logs.find(l => !l.clockOut);
    if (!activeLog) {
      throw new BadRequestException('Already clocked out');
    }

    const now = new Date();
    let isEarlyLeave = false;
    let status = 'PRESENT';
    let overtimeHours = 0;

    // The roster's window again, so leaving a 14:00-finish on-site day at 14:05
    // is not recorded as a half day against the 18:00 office shift.
    if (effective.endTime) {
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
    }

    await this.prisma.attendanceLog.update({
      where: { id: activeLog.id },
      data: {
        clockOut: now,
        clockOutLat: data.lat,
        clockOutLng: data.lng
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
        overtimeHours
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
