import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { istDateKey, istTimeInstant } from '../common/timezone.util';
import { haversineKm } from '../common/geo.util';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
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

  async getMyHistory(userId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee profile not found');

    return this.prisma.attendance.findMany({
      where: { employeeId: employee.id },
      include: { employee: { include: { department: true } }, logs: true },
      orderBy: { date: 'desc' }
    }).then(rows => rows.map(r => this.withTotalHours(r)));
  }

  async getEmployeeHistory(employeeId: number) {
    return this.prisma.attendance.findMany({
      where: { employeeId },
      include: { employee: { include: { department: true } }, logs: true },
      orderBy: { date: 'desc' }
    }).then(rows => rows.map(r => this.withTotalHours(r)));
  }

  async clockIn(userId: number, data: { lat?: number, lng?: number, ipAddress?: string }) {
    const employee = await this.prisma.employee.findUnique({ 
      where: { userId },
      include: { shift: true, branch: true }
    });
    if (!employee) throw new BadRequestException('Employee profile not found');

    const branch = employee.branch;
    if (branch) {
      // 1. IP Restriction Check
      if (branch.allowedIps) {
        const allowed = branch.allowedIps.split(',').map(ip => ip.trim());
        if (data.ipAddress && !allowed.includes(data.ipAddress)) {
          throw new BadRequestException(`Clock-in denied. IP Address ${data.ipAddress} is not in the allowed list.`);
        }
      }

      // 2. Geofencing Check — only enforced once an admin has actually set the
      // branch's coordinates; branches without them behave as before (no check).
      if (branch.latitude != null && branch.longitude != null && branch.geofenceRadius) {
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

    const nowLocal = new Date();
    const today = istDateKey(nowLocal);

    let existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
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

    if (employee.shift) {
      // Shift times ("09:00") are IST wall-clock, not server-local — istTimeInstant
      // resolves them to the correct real-world instant regardless of what
      // timezone this server's OS happens to be configured with.
      const expectedStart = istTimeInstant(now, employee.shift.startTime);
      const maxStartTime = new Date(expectedStart.getTime() + (employee.shift.bufferTimeMinutes * 60000));

      if (now > maxStartTime) {
        isLate = true;
      }
    }

    if (!existing) {
      existing = await this.prisma.attendance.create({
        data: {
          employeeId: employee.id,
          date: today,
          clockIn: now,
          clockInLat: data.lat,
          clockInLng: data.lng,
          isLate
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
        clockOut: null, // Reset clockOut on parent since they are active
        clockIn: existing.clockIn || now
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

    const branch = employee.branch;
    if (branch && branch.latitude != null && branch.longitude != null && branch.geofenceRadius) {
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

    const nowLocal = new Date();
    const today = istDateKey(nowLocal);

    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
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

    if (employee.shift) {
      // Same IST-fixed resolution as clockIn — see the comment there.
      const expectedEnd = istTimeInstant(now, employee.shift.endTime);

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
