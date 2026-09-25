import { LeavesService } from './leaves.service';

/**
 * §9 from the leave side: applying for leave over an approved field visit.
 *
 * The request is allowed — refusing outright would leave someone ill with
 * nowhere to go — but the approver is told what approving it costs, and
 * granting it takes those days off the trip in the same write.
 */

const EMPLOYEE = {
  id: 60, userId: 500, companyId: 1,
  firstName: 'Asha', lastName: 'Rao', departmentId: 2,
  user: { id: 500, role: 'EMPLOYEE' },
  branch: { weeklyOffs: '0' },
  manager: { user: { id: 400 } },
};

const CONFLICT = {
  requestNumber: 'FVR-0009',
  location: 'Client Site – Delhi',
  days: 2,
  dates: ['2026-10-01', '2026-10-02'],
};

function makeService(over: any = {}) {
  const prisma: any = {
    employee: {
      findUnique: jest.fn().mockResolvedValue(EMPLOYEE),
    },
    blackoutDate: { findMany: jest.fn().mockResolvedValue([]) },
    leaveRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({
        id: 30, employeeId: 60, leaveTypeId: 2, status: 'PENDING',
        isHalfDay: false,
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2026-10-02T00:00:00.000Z'),
        employee: { ...EMPLOYEE, branch: { weeklyOffs: '0' } },
      }),
      create: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 30, ...a.data })),
      update: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 30, ...a.data })),
    },
    leaveBalance: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    holiday: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 900, role: 'ADMIN', employee: { id: 90 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...over,
  };
  prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));

  const notifications: any = {
    createNotification: jest.fn().mockResolvedValue({}),
    notifyEmployees: jest.fn().mockResolvedValue(1),
  };
  const fieldVisits: any = {
    conflictsFor: jest.fn().mockResolvedValue([CONFLICT]),
    releaseDaysForLeave: jest.fn().mockResolvedValue([
      { requestId: 9, requestNumber: 'FVR-0009', raisedById: 71, days: 2, archivedTasks: 0 },
    ]),
  };
  return {
    service: new LeavesService(prisma, notifications, fieldVisits),
    prisma, notifications, fieldVisits,
  };
}

const APPLY = {
  leaveTypeId: 2,
  startDate: '2026-10-01',
  endDate: '2026-10-02',
  reason: 'Family function',
};

describe('applying for leave over a field visit', () => {
  it('is allowed, and comes back saying what it clashes with', async () => {
    const { service } = makeService();
    const request: any = await service.requestLeave(500, APPLY);

    expect(request.id).toBe(30);
    expect(request.fieldVisitConflicts).toEqual([CONFLICT]);
  });

  it('tells the approver what approving it would cost', async () => {
    const { service, notifications } = makeService();
    await service.requestLeave(500, APPLY);

    const message = notifications.createNotification.mock.calls[0][2];
    expect(message).toContain('Asha Rao has requested leave from 2026-10-01 to 2026-10-02.');
    expect(message).toContain('approved field visit FVR-0009 at Client Site – Delhi (2 days)');
    expect(message).toContain('takes those days off the trip');
  });

  it('leaves an ordinary leave request reading exactly as it did', async () => {
    const { service, notifications, fieldVisits } = makeService();
    fieldVisits.conflictsFor.mockResolvedValue([]);

    await service.requestLeave(500, APPLY);
    expect(notifications.createNotification.mock.calls[0][2])
      .toBe('Asha Rao has requested leave from 2026-10-01 to 2026-10-02.');
  });
});

describe('approving that leave', () => {
  it('releases the days inside the same write that grants it', async () => {
    const { service, prisma, fieldVisits } = makeService();
    await service.updateRequestStatus(900, 30, 'APPROVED');

    expect(fieldVisits.releaseDaysForLeave).toHaveBeenCalledWith(prisma, {
      employeeId: 60,
      companyId: 1,
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-02T00:00:00.000Z'),
      isHalfDay: false,
      actorId: 90,
    });
  });

  it('tells the project manager their person is not coming', async () => {
    const { service, notifications } = makeService();
    await service.updateRequestStatus(900, 30, 'APPROVED');

    expect(notifications.notifyEmployees).toHaveBeenCalledWith(
      [71],
      expect.objectContaining({
        title: 'Field visit: someone is on leave',
        message: 'Asha Rao has approved leave covering 2 day(s) of FVR-0009.',
      }),
    );
  });

  it('mentions archived tasks when the leave swallowed the whole trip', async () => {
    const { service, notifications, fieldVisits } = makeService();
    fieldVisits.releaseDaysForLeave.mockResolvedValue([
      { requestId: 9, requestNumber: 'FVR-0009', raisedById: 71, days: 3, archivedTasks: 4 },
    ]);

    await service.updateRequestStatus(900, 30, 'APPROVED');
    expect(notifications.notifyEmployees.mock.calls[0][1].message)
      .toContain('Their 4 task(s) on it were archived.');
  });

  it('says nothing to anybody when no trip was touched', async () => {
    const { service, notifications, fieldVisits } = makeService();
    fieldVisits.releaseDaysForLeave.mockResolvedValue([]);

    await service.updateRequestStatus(900, 30, 'APPROVED');
    expect(notifications.notifyEmployees).not.toHaveBeenCalled();
  });

  it('releases nothing when the leave is rejected', async () => {
    const { service, fieldVisits } = makeService();
    await service.updateRequestStatus(900, 30, 'REJECTED', 'Too close to go-live');
    expect(fieldVisits.releaseDaysForLeave).not.toHaveBeenCalled();
  });
});
