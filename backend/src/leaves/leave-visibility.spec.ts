import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LeavesService } from './leaves.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FieldVisitActivationService } from '../field-visits/requests/field-visit-activation.service';
import { ApprovalsService } from '../approvals/approvals.service';

describe('leave request visibility', () => {
  let service: LeavesService;
  const prisma = {
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeavesService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: {} },
        { provide: FieldVisitActivationService, useValue: {} },
        { provide: ApprovalsService, useValue: { mayApprove: jest.fn() } },
      ],
    }).compile();
    service = module.get<LeavesService>(LeavesService);
  });

  it('limits company-wide leave requests to HR and admins', async () => {
    await expect(service.getRequests(7, {}, 'EMPLOYEE')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.leaveRequest.findMany).not.toHaveBeenCalled();

    prisma.leaveRequest.findMany.mockResolvedValue([]);
    await service.getRequests(7, {}, 'SUPERADMIN');
    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { employee: { companyId: 7 }, deletedAt: null },
    }));
  });

  it('returns request history from every level below a manager', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 1 });
    prisma.employee.findMany.mockImplementation(({ where }: { where: { managerId: number } }) =>
      Promise.resolve(({ 1: [{ id: 2 }], 2: [{ id: 3 }], 3: [] } as Record<number, { id: number }[]>)[where.managerId] || []),
    );
    prisma.leaveRequest.findMany.mockResolvedValue([]);

    await service.getManagerRequests(12);

    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { employeeId: { in: [2, 3] }, deletedAt: null },
    }));
  });
});
