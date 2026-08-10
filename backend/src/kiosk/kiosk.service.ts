import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';

@Injectable()
export class KioskService {
  constructor(
    private prisma: PrismaService,
    private attendanceService: AttendanceService
  ) {}

  async clockIn(pin: string, companyId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        kioskPin: pin,
        companyId: companyId
      }
    });

    if (!employee) {
      throw new UnauthorizedException('Invalid PIN');
    }

    const record = await this.attendanceService.clockIn(employee.userId, {});
    return {
      message: `Clocked in successfully. Welcome, ${employee.firstName}!`,
      record
    };
  }

  async clockOut(pin: string, companyId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        kioskPin: pin,
        companyId: companyId
      }
    });

    if (!employee) {
      throw new UnauthorizedException('Invalid PIN');
    }

    const record = await this.attendanceService.clockOut(employee.userId, {});
    return {
      message: `Clocked out successfully. Goodbye, ${employee.firstName}!`,
      record
    };
  }
}
