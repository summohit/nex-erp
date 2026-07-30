import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  async getTodayAttendance(userId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee profile not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.attendance.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: today
        }
      }
    });
  }

  async getMyHistory(userId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee profile not found');

    return this.prisma.attendance.findMany({
      where: { employeeId: employee.id },
      orderBy: { date: 'desc' }
    });
  }

  async clockIn(userId: number, data: { lat?: number, lng?: number }) {
    const employee = await this.prisma.employee.findUnique({ 
      where: { userId },
      include: { shift: true }
    });
    if (!employee) throw new BadRequestException('Employee profile not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
      });
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
    });
  }

  async clockOut(userId: number, data: { lat?: number, lng?: number }) {
    const employee = await this.prisma.employee.findUnique({ 
      where: { userId },
      include: { shift: true }
    });
    if (!employee) throw new BadRequestException('Employee profile not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

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

    if (employee.shift) {
      const shiftEndTokens = employee.shift.endTime.split(':');
      const shiftEndHour = parseInt(shiftEndTokens[0], 10);
      const shiftEndMinute = parseInt(shiftEndTokens[1], 10);
      
      const expectedEnd = new Date(now);
      expectedEnd.setHours(shiftEndHour, shiftEndMinute, 0, 0);
      
      if (now < expectedEnd) {
        isEarlyLeave = true;
        status = 'HALF_DAY';
      }
    }

    return this.prisma.attendance.update({
      where: { id: existing.id },
      data: {
        clockOut: now,
        clockOutLat: data.lat,
        clockOutLng: data.lng,
        isEarlyLeave,
        status
      }
    });
  }
}
