import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  async getTodayAttendance(userId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee profile not found');

    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

    return this.prisma.attendance.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: today
        }
      }
    }).then(r => this.withTotalHours(r));
  }

  private withTotalHours(record: any) {
    if (!record) return record;
    let totalHours = 0;
    if (record.clockIn) {
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
      include: { employee: { include: { department: true } } },
      orderBy: { date: 'desc' }
    }).then(rows => rows.map(r => this.withTotalHours(r)));
  }

  async getEmployeeHistory(employeeId: number) {
    return this.prisma.attendance.findMany({
      where: { employeeId },
      include: { employee: { include: { department: true } } },
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

      // 2. Geofencing Check (Simple Haversine distance check could be added here)
      // Since lat/lng for branch is not explicitly stored in this DB yet, we just enforce the requirement
      // if geofenceRadius is defined and strict mode is on.
      // (Implementation requires adding branch.latitude and branch.longitude in the future)
    }

    const nowLocal = new Date();
    const today = new Date(Date.UTC(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate()));

    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } }
    });

    if (existing && existing.clockIn) {
      throw new BadRequestException('Already clocked in today');
    }

    const now = new Date();
    let isLate = false;

    if (employee.shift) {
      const shiftStartTokens = employee.shift.startTime.split(':');
      const shiftStartHour = parseInt(shiftStartTokens[0], 10);
      const shiftStartMinute = parseInt(shiftStartTokens[1], 10);
      
      const expectedStart = new Date(now);
      expectedStart.setHours(shiftStartHour, shiftStartMinute, 0, 0);
      
      // Add buffer time
      const maxStartTime = new Date(expectedStart.getTime() + (employee.shift.bufferTimeMinutes * 60000));
      
      if (now > maxStartTime) {
        isLate = true;
      }
    }

    if (existing) {
      return this.prisma.attendance.update({
        where: { id: existing.id },
        data: {
          clockIn: now,
          clockInLat: data.lat,
          clockInLng: data.lng,
          isLate
        }
      }).then(r => this.withTotalHours(r));
    }

    return this.prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: today,
        clockIn: now,
        clockInLat: data.lat,
        clockInLng: data.lng,
        isLate
      }
    }).then(r => this.withTotalHours(r));
  }

  async clockOut(userId: number, data: { lat?: number, lng?: number }) {
    const employee = await this.prisma.employee.findUnique({ 
      where: { userId },
      include: { shift: true }
    });
    if (!employee) throw new BadRequestException('Employee profile not found');

    const nowLocal = new Date();
    const today = new Date(Date.UTC(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate()));

    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } }
    });

    if (!existing || !existing.clockIn) {
      throw new BadRequestException('You must clock in first');
    }

    if (existing.clockOut) {
      throw new BadRequestException('Already clocked out today');
    }

    const now = new Date();
    let isEarlyLeave = false;
    let status = 'PRESENT';
    let overtimeHours = 0;

    if (employee.shift) {
      const shiftEndTokens = employee.shift.endTime.split(':');
      const shiftEndHour = parseInt(shiftEndTokens[0], 10);
      const shiftEndMinute = parseInt(shiftEndTokens[1], 10);
      
      const expectedEnd = new Date(now);
      expectedEnd.setHours(shiftEndHour, shiftEndMinute, 0, 0);
      
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

    return this.prisma.attendance.update({
      where: { id: existing.id },
      data: {
        clockOut: now,
        clockOutLat: data.lat,
        clockOutLng: data.lng,
        isEarlyLeave,
        status,
        overtimeHours
      }
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
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee not found');
    const date = new Date(data.date);
    return this.prisma.attendanceRegularization.create({
      data: {
        employeeId: employee.id,
        date,
        proposedClockIn: data.proposedClockIn ? new Date(data.proposedClockIn) : null,
        proposedClockOut: data.proposedClockOut ? new Date(data.proposedClockOut) : null,
        reason: data.reason
      }
    });
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
    
    return this.prisma.attendanceRegularization.update({
      where: { id },
      data: {
        status,
        rejectionReason,
        approvedById: approverUserId
      }
    });
  }

  async getTeamTimeline(companyId: number, startDateStr: string, endDateStr: string) {
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

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
}
