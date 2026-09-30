import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { VisitLocationRequestsService } from './visit-location-requests.service';

const REQUEST = {
  id: 12,
  name: 'Client Warehouse',
  address: '42 Industrial Road',
  latitude: 28.6139,
  longitude: 77.209,
  position: 0,
  leadContactId: 8,
  status: 'PENDING',
  requestedById: 21,
  requestedBy: {
    id: 21,
    firstName: 'Priya',
    lastName: 'Shah',
    avatarUrl: null,
  },
  reviewedBy: null,
  leadContact: { id: 8, name: 'Acme', companyName: 'Acme Ltd' },
  visitLocation: null,
  reviewedAt: null,
  rejectionReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService(projectCount = 1) {
  const prisma: any = {
    project: { count: jest.fn().mockResolvedValue(projectCount) },
    leadContact: { findFirst: jest.fn().mockResolvedValue({ id: 8 }) },
    visitLocation: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 44 }),
    },
    visitLocationRequest: {
      findFirst: jest.fn().mockResolvedValue(REQUEST),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(REQUEST),
      update: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve({ ...REQUEST, ...data }),
        ),
    },
  };
  prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));

  const notifications: any = {
    notifyApprovers: jest.fn().mockResolvedValue(1),
    notifyEmployees: jest.fn().mockResolvedValue(1),
  };

  return {
    service: new VisitLocationRequestsService(prisma, notifications),
    prisma,
    notifications,
  };
}

describe('visit location requests', () => {
  it('allows a project manager to submit a pending location', async () => {
    const { service, prisma, notifications } = makeService();
    prisma.visitLocationRequest.findFirst.mockResolvedValueOnce(null);

    await service.create(3, 21, 'EMPLOYEE', {
      name: ' Client Warehouse ',
      address: '42 Industrial Road',
      latitude: 28.6139,
      longitude: 77.209,
      leadContactId: 8,
    });

    expect(prisma.visitLocationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 3,
          requestedById: 21,
          name: 'Client Warehouse',
        }),
      }),
    );
    expect(notifications.notifyApprovers).toHaveBeenCalled();
  });

  it('refuses an employee who does not manage a project', async () => {
    const { service } = makeService(0);

    await expect(
      service.create(3, 22, 'EMPLOYEE', { name: 'Warehouse' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires an administrator to review a request', async () => {
    const { service } = makeService();

    await expect(
      service.review(3, 21, 'EMPLOYEE', 12, 'APPROVED'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires and preserves a rejection reason', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.review(3, 30, 'ADMIN', 12, 'REJECTED', '   '),
    ).rejects.toThrow(BadRequestException);

    await service.review(3, 30, 'ADMIN', 12, 'REJECTED', 'Duplicate site');

    expect(prisma.visitLocationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED',
          reviewedById: 30,
          rejectionReason: 'Duplicate site',
        }),
      }),
    );
    expect(prisma.visitLocation.create).not.toHaveBeenCalled();
  });

  it('creates and links an active location in the approval transaction', async () => {
    const { service, prisma, notifications } = makeService();

    await service.review(3, 30, 'ADMIN', 12, 'APPROVED');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.visitLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 3,
          name: 'Client Warehouse',
          leadContactId: 8,
        }),
      }),
    );
    expect(prisma.visitLocationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED',
          reviewedById: 30,
          visitLocationId: 44,
        }),
      }),
    );
    expect(notifications.notifyEmployees).toHaveBeenCalled();
  });
});
