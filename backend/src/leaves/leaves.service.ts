import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LeavesService {
  constructor(private prisma: PrismaService) {}

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

  async requestLeave(userId: number, data: { leaveTypeId: number, startDate: string, endDate: string, reason?: string, attachmentUrl?: string }) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Employee not found');

    return this.prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: data.leaveTypeId,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        reason: data.reason,
        attachmentUrl: data.attachmentUrl
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

  async updateRequest(userId: number, requestId: number, data: { startDate?: string, endDate?: string, reason?: string, attachmentUrl?: string }) {
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

    return this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: updateData
    });
  }

  async cancelRequest(userId: number, requestId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
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
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        
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
      include: { employee: true }
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
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        
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
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        
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
}
