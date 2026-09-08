import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ShiftInput {
  name?: string;
  shortCode?: string;
  colorCode?: string;
  shiftType?: string; // STRICT | FLEXIBLE
  startTime?: string;
  endTime?: string;
  bufferTimeMinutes?: number;
  halfDayTime?: string;
  halfDayHours?: number;
  totalHours?: number;
  earlyClockInMinutes?: number;
  autoClockOutHours?: number;
  maxCheckIns?: number;
  workingDays?: string[] | string;
}

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: number) {
    return this.prisma.shift.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { employees: true }
        }
      }
    });
  }

  async getShiftEmployees(companyId: number, shiftId: number) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, companyId },
      select: {
        id: true,
        name: true,
        shortCode: true,
        colorCode: true,
        shiftType: true,
        startTime: true,
        endTime: true,
        totalHours: true,
      }
    });

    if (!shift) {
      throw new BadRequestException('Shift not found');
    }

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        shiftId
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        avatarUrl: true,
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, status: true, role: true } }
      },
      orderBy: [
        { firstName: 'asc' },
        { lastName: 'asc' }
      ]
    });

    return {
      shift,
      employees,
      totalCount: employees.length
    };
  }

  async getMyShift(userId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: {
        shift: true,
        shiftRotations: { select: { id: true, name: true, description: true, rotationType: true } },
      },
    });

    if (!employee) throw new BadRequestException('Employee profile not found');

    return {
      shift: employee.shift || null,
      rotations: employee.shiftRotations || [],
    };
  }

  async create(companyId: number, data: ShiftInput) {
    if (!data.name) {
      throw new BadRequestException('Name is required');
    }
    // A FLEXIBLE shift is judged on hours worked, so it needs totalHours rather
    // than a clock window; a STRICT one needs the window.
    if ((data.shiftType || 'STRICT') === 'FLEXIBLE') {
      if (!data.totalHours) throw new BadRequestException('Total hours are required for a flexible shift');
    } else if (!data.startTime || !data.endTime) {
      throw new BadRequestException('Start and end time are required for a strict shift');
    }

    return this.prisma.shift.create({
      data: { ...this.toShiftData(data), name: data.name, companyId },
    });
  }

  async update(companyId: number, id: number, data: ShiftInput) {
    const existing = await this.prisma.shift.findUnique({ where: { id } });
    if (!existing || existing.companyId !== companyId) {
      throw new BadRequestException('Shift not found');
    }

    return this.prisma.shift.update({
      where: { id },
      data: { ...this.toShiftData(data), name: data.name },
    });
  }

  /** Shared field mapping; undefined values are left untouched by Prisma. */
  private toShiftData(d: ShiftInput) {
    return {
      shortCode: d.shortCode,
      colorCode: d.colorCode,
      shiftType: d.shiftType,
      startTime: d.startTime,
      endTime: d.endTime,
      bufferTimeMinutes: d.bufferTimeMinutes,
      halfDayTime: d.halfDayTime,
      halfDayHours: d.halfDayHours,
      totalHours: d.totalHours,
      earlyClockInMinutes: d.earlyClockInMinutes,
      autoClockOutHours: d.autoClockOutHours,
      maxCheckIns: d.maxCheckIns,
      workingDays: Array.isArray(d.workingDays) ? d.workingDays.join(',') : d.workingDays,
    };
  }

  async delete(companyId: number, id: number) {
    const existing = await this.prisma.shift.findUnique({ where: { id } });
    if (!existing || existing.companyId !== companyId) {
      throw new BadRequestException('Shift not found');
    }

    return this.prisma.shift.delete({ where: { id } });
  }
}
