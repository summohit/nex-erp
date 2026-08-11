import { Injectable, BadRequestException, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LeavesService implements OnModuleInit {
  private readonly logger = new Logger(LeavesService.name);

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.startAccrualCron();
  }

  private startAccrualCron() {
    // Run once a day at midnight
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    setInterval(() => {
      this.processAutomatedAccruals().catch(err => this.logger.error('Failed to process accruals', err));
    }, ONE_DAY_MS);
    
    // Also run immediately on startup if needed, but usually we just let it run on schedule
  }

  async processAutomatedAccruals() {
    this.logger.log('Running automated leave accruals check...');
    const now = new Date();
    // Only run on the 1st of the month for MONTHLY accruals, or Jan 1st for YEARLY.
    // For simplicity in this implementation, we will assume it runs and checks logic.
    const isFirstOfMonth = now.getDate() === 1;
    const isFirstOfYear = now.getMonth() === 0 && now.getDate() === 1;
    const year = now.getFullYear();

    if (!isFirstOfMonth && !isFirstOfYear) return;

    const leaveTypes = await this.prisma.leaveType.findMany({
      where: { accrualAmount: { gt: 0 } }
    });

    for (const lt of leaveTypes) {
      if (lt.accrualFrequency === 'MONTHLY' && isFirstOfMonth) {
        await this.prisma.leaveBalance.updateMany({
          where: { leaveTypeId: lt.id, year },
          data: { allocated: { increment: lt.accrualAmount } }
        });
        this.logger.log(`Credited ${lt.accrualAmount} for Monthly Leave Type: ${lt.name}`);
      } else if (lt.accrualFrequency === 'YEARLY' && isFirstOfYear) {
        await this.prisma.leaveBalance.updateMany({
          where: { leaveTypeId: lt.id, year },
          data: { allocated: { increment: lt.accrualAmount } }
        });
        this.logger.log(`Credited ${lt.accrualAmount} for Yearly Leave Type: ${lt.name}`);
      }
    }
  }

  async assignLeaveBalance(data: { employeeId: number, leaveTypeId: number, allocated: number, year: number }) {
    return this.prisma.leaveBalance.upsert({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: data.employeeId,
          leaveTypeId: data.leaveTypeId,
          year: data.year
        }
      },
      update: {
        allocated: data.allocated
      },
      create: {
        employeeId: data.employeeId,
        leaveTypeId: data.leaveTypeId,
        allocated: data.allocated,
        year: data.year
      }
    });
  }

  async getMyBalances(userId: number, year: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee not found');
    
    return this.prisma.leaveBalance.findMany({
      where: { employeeId: employee.id, year },
      include: { leaveType: true }
    });
  }

  async getAllBalances(companyId: number, year: number) {
    return this.prisma.leaveBalance.findMany({
      where: { employee: { companyId }, year },
      include: { 
        employee: { select: { id: true, firstName: true, lastName: true } },
        leaveType: true 
      }
    });
  }

  async requestLeave(userId: number, data: { leaveTypeId: number, startDate: string, endDate: string, reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string }) {
    const employee = await this.prisma.employee.findUnique({ 
      where: { userId },
      include: { user: true, branch: true }
    });
    if (!employee) throw new BadRequestException('Employee not found');

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (startDate < today) {
      throw new BadRequestException('Cannot apply for leave in the past');
    }

    if (employee.user.role !== 'SUPERADMIN' && employee.user.role !== 'ADMIN' && employee.user.role !== 'HR') {
      const blackouts = await this.prisma.blackoutDate.findMany({
        where: {
          companyId: employee.companyId,
          date: {
            gte: startDate,
            lte: endDate
          },
          OR: [
            { departmentId: null },
            { departmentId: employee.departmentId }
          ]
        }
      });
      if (blackouts.length > 0) {
        throw new BadRequestException(`Leave request overlaps with a blackout date: ${blackouts[0].date.toDateString()} - ${blackouts[0].reason}`);
      }
    }

    const overlappingLeaves = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: employee.id,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: endDate },
        endDate: { gte: startDate }
      }
    });

    if (overlappingLeaves.length > 0) {
      throw new BadRequestException('Leave overlaps with existing request');
    }

    const workingDays = this.calculateWorkingDays(startDate, endDate, employee.branch?.weeklyOffs || '0', data.isHalfDay || false);
    if (workingDays === 0) {
      throw new BadRequestException('Leave duration evaluates to 0 working days.');
    }

    return this.prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: data.leaveTypeId,
        startDate,
        endDate,
        reason: data.reason,
        attachmentUrl: data.attachmentUrl,
        isHalfDay: data.isHalfDay || false,
        halfDayPeriod: data.halfDayPeriod || null
      }
    });
  }

  async getRequests(companyId: number, filter: any) {
    return this.prisma.leaveRequest.findMany({
      where: { employee: { companyId } },
      include: { 
        employee: { select: { id: true, firstName: true, lastName: true } },
        leaveType: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async updateRequest(userId: number, requestId: number, data: { startDate?: string, endDate?: string, reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string }) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee not found');

    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, employeeId: employee.id }
    });

    if (!request) throw new BadRequestException('Request not found or not authorized');
    if (request.status !== 'PENDING') throw new BadRequestException('Only pending requests can be edited');

    const updateData: any = {};
    if (data.startDate) updateData.startDate = new Date(data.startDate);
    if (data.endDate) updateData.endDate = new Date(data.endDate);
    if (data.reason !== undefined) updateData.reason = data.reason;
    if (data.attachmentUrl !== undefined) updateData.attachmentUrl = data.attachmentUrl;
    if (data.isHalfDay !== undefined) updateData.isHalfDay = data.isHalfDay;
    if (data.halfDayPeriod !== undefined) updateData.halfDayPeriod = data.halfDayPeriod;

    return this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: updateData
    });
  }

  async cancelRequest(userId: number, requestId: number) {
    const employee = await this.prisma.employee.findUnique({ 
      where: { userId },
      include: { branch: true }
    });
    if (!employee) throw new BadRequestException('Employee not found');

    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, employeeId: employee.id }
    });

    if (!request) throw new BadRequestException('Request not found or not authorized');
    if (request.status === 'REJECTED' || request.status === 'CANCELLED') {
      throw new BadRequestException('Request is already ' + request.status.toLowerCase());
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.leaveRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED' }
      });

      if (request.status === 'APPROVED') {
        const start = new Date(request.startDate);
        const end = new Date(request.endDate);
        const diffDays = this.calculateWorkingDays(start, end, employee.branch?.weeklyOffs || '0', request.isHalfDay);
        
        await tx.leaveBalance.updateMany({
          where: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year: start.getFullYear()
          },
          data: {
            used: { decrement: diffDays }
          }
        });
      }

      return updatedRequest;
    });
  }

  async getMyRequests(userId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee not found');

    return this.prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      include: { leaveType: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async updateRequestStatus(userId: number, requestId: number, status: string, rejectionReason?: string) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: { include: { branch: true } } }
    });

    if (!request) throw new BadRequestException('Request not found');
    if (status === 'REJECTED' && !rejectionReason) throw new BadRequestException('Rejection reason is required');

    return this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.leaveRequest.update({
        where: { id: requestId },
        data: {
          status,
          rejectionReason: status === 'REJECTED' ? rejectionReason : null,
          approvedById: userId
        }
      });

      if (status === 'APPROVED' && request.status !== 'APPROVED') {
        const start = new Date(request.startDate);
        const end = new Date(request.endDate);
        const diffDays = this.calculateWorkingDays(start, end, request.employee.branch?.weeklyOffs || '0', request.isHalfDay);
        
        await tx.leaveBalance.updateMany({
          where: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year: start.getFullYear()
          },
          data: {
            used: { increment: diffDays }
          }
        });
      } else if (status === 'REJECTED' && request.status === 'APPROVED') {
        const start = new Date(request.startDate);
        const end = new Date(request.endDate);
        const diffDays = this.calculateWorkingDays(start, end, request.employee.branch?.weeklyOffs || '0', request.isHalfDay);
        
        await tx.leaveBalance.updateMany({
          where: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year: start.getFullYear()
          },
          data: {
            used: { decrement: diffDays }
          }
        });
      }

      return updatedRequest;
    });
  }

  private calculateWorkingDays(start: Date, end: Date, weeklyOffsStr: string, isHalfDay: boolean): number {
    const offDays = new Set<number>();
    if (weeklyOffsStr) {
      weeklyOffsStr.split(',').forEach(p => {
        const parts = p.trim().split(':');
        if (parts[0]) offDays.add(parseInt(parts[0], 10));
      });
    } else {
      offDays.add(0); // Default to Sunday
    }

    let count = 0;
    const current = new Date(start);
    current.setHours(0,0,0,0);
    const last = new Date(end);
    last.setHours(0,0,0,0);

    while (current <= last) {
      if (!offDays.has(current.getDay())) {
        count++;
      }
      current.setDate(current.getDate() + 1);
    }

    return isHalfDay ? (count > 0 ? 0.5 : 0) : count;
  }
}
