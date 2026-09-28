import { LeavesService } from './leaves.service';

/**
 * §Att9 — leave raised for somebody else — and §Att10 — leave removed.
 *
 * Both turn on who is allowed to act, and on the two things that must stay
 * true afterwards: the record says who did it, and the balance is right.
 */

const ACTOR = {
  id: 9, role: 'HR', employee: { id: 5, companyId: 1 },
};

const TARGET = {
  id: 60, companyId: 1, departmentId: 2,
  user: { role: 'EMPLOYEE' },
  branch: { weeklyOffs: '0' },
  manager: { user: { id: 11 } },
};

const REQUEST = {
  id: 30, employeeId: 60, leaveTypeId: 2, status: 'APPROVED',
  isHalfDay: false,
  startDate: new Date('2026-10-01T00:00:00.000Z'),
  endDate: new Date('2026-10-02T00:00:00.000Z'),
  employee: { ...TARGET, branch: { weeklyOffs: '0' } },
};

function build(over: { actorRole?: string; mayApprove?: boolean } = {}) {
  const tx = {
    leaveRequest: {
      update: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 30, ...a.data })),
    },
    leaveBalance: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    employee: { findUnique: jest.fn().mockResolvedValue({ ...TARGET, user: { id: 70 } }) },
  };

  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        ...ACTOR, role: over.actorRole ?? ACTOR.role,
      }),
    },
    employee: {
      findUnique: jest.fn().mockResolvedValue(TARGET),
      findFirst: jest.fn().mockResolvedValue(TARGET),
    },
    leaveType: { findFirst: jest.fn().mockResolvedValue({ id: 2, name: 'Sick', allowHalfDay: true }) },
    blackoutDate: { findMany: jest.fn().mockResolvedValue([]) },
    leaveRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(REQUEST),
      create: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 30, ...a.data })),
      update: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 30, ...a.data })),
    },
    leaveBalance: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    holiday: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
  };

  const approvals = {
    mayApprove: jest.fn().mockResolvedValue(over.mayApprove ?? false),
  };
  const notifications = {
    notifyEmployees: jest.fn(),
    createNotification: jest.fn(),
  };
  const fieldVisits = {
    conflictsFor: jest.fn().mockResolvedValue([]),
    releaseDaysForLeave: jest.fn().mockResolvedValue([]),
    // §Att10: deleting leave hands the days back to the standing shift.
    restoreStandingShiftAfterLeave: jest.fn().mockResolvedValue(0),
  };

  return {
    prisma, tx, approvals, fieldVisits,
    service: new LeavesService(prisma, notifications as any, fieldVisits as any, approvals as any),
  };
}

describe('who may act on somebody else’s leave', () => {
  it('lets HR, without anybody delegating it to them', async () => {
    const { service, approvals } = build({ actorRole: 'HR' });
    expect(await service.mayActOnBehalf(1, 'HR', 5)).toBe(true);
    // The role settled it; the delegate table was never consulted.
    expect(approvals.mayApprove).not.toHaveBeenCalled();
  });

  it('lets a Super Admin', async () => {
    const { service } = build();
    expect(await service.mayActOnBehalf(1, 'SUPERADMIN', 5)).toBe(true);
  });

  it('lets a delegate who holds no such role', async () => {
    const { service } = build({ mayApprove: true });
    expect(await service.mayActOnBehalf(1, 'EMPLOYEE', 5)).toBe(true);
  });

  it('refuses an ordinary employee who is on no list', async () => {
    const { service } = build({ mayApprove: false });
    expect(await service.mayActOnBehalf(1, 'EMPLOYEE', 5)).toBe(false);
  });
});

describe('raising leave for somebody else', () => {
  it('is refused outright when they may not', async () => {
    const { service } = build({ actorRole: 'EMPLOYEE', mayApprove: false });
    await expect(service.requestLeaveOnBehalf(9, {
      employeeId: 60, leaveTypeId: 2,
      startDate: '2026-10-01', endDate: '2026-10-02',
    })).rejects.toThrow(/not allowed to apply leave for other people/i);
  });

  it('records who raised it, so it is not mistaken for self-applied leave', async () => {
    const { service, prisma } = build({ actorRole: 'HR' });
    await service.requestLeaveOnBehalf(9, {
      employeeId: 60, leaveTypeId: 2,
      startDate: '2026-10-01', endDate: '2026-10-02',
    });
    expect(prisma.leaveRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ raisedById: 9, employeeId: 60 }) }),
    );
  });

  /**
   * The backdating case is the whole point of the feature: recording the week
   * somebody was off sick and in no position to file anything.
   */
  it('allows a past date, which an employee applying for themselves cannot', async () => {
    const { service } = build({ actorRole: 'HR' });
    await expect(service.requestLeaveOnBehalf(9, {
      employeeId: 60, leaveTypeId: 2,
      startDate: '2020-01-06', endDate: '2020-01-07',
    })).resolves.toBeDefined();
  });

  it('still refuses a past date for somebody applying for themselves', async () => {
    const { service } = build();
    await expect(service.requestLeave(9, {
      leaveTypeId: 2, startDate: '2020-01-06', endDate: '2020-01-07',
    })).rejects.toThrow(/in the past/i);
  });
});

describe('removing a leave request', () => {
  it('is refused to anybody but a Super Admin', async () => {
    const { service } = build({ actorRole: 'HR' });
    await expect(service.deleteRequest(9, 30))
      .rejects.toThrow(/Only a Super Admin can delete/i);
  });

  it('marks the row deleted and says who did it, rather than removing it', async () => {
    const { service, tx } = build({ actorRole: 'SUPERADMIN' });
    await service.deleteRequest(9, 30);
    expect(tx.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 30 },
        data: expect.objectContaining({ deletedById: 9, deletedAt: expect.any(Date) }),
      }),
    );
  });

  /**
   * The failure that would be invisible: remove an approved request, leave the
   * balance spent, and the employee has quietly lost those days twice.
   */
  it('gives back the days an approved request had consumed', async () => {
    const { service, tx } = build({ actorRole: 'SUPERADMIN' });
    await service.deleteRequest(9, 30);
    expect(tx.leaveBalance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { used: { decrement: expect.any(Number) } },
      }),
    );
  });

  /**
   * §Att10: the days become theirs to work again, so the roster must stop
   * describing them as somebody else's. It must NOT put them back on a client
   * visit the leave took them off — that plan has moved on.
   */
  it('hands the days back to their standing shift', async () => {
    const { service, fieldVisits } = build({ actorRole: 'SUPERADMIN' });
    await service.deleteRequest(9, 30);
    expect(fieldVisits.restoreStandingShiftAfterLeave).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeId: 60 }),
    );
  });

  it('touches no balance when the request was never approved', async () => {
    const { service, tx, prisma } = build({ actorRole: 'SUPERADMIN' });
    prisma.leaveRequest.findFirst.mockResolvedValue({ ...REQUEST, status: 'PENDING' });
    await service.deleteRequest(9, 30);
    expect(tx.leaveBalance.updateMany).not.toHaveBeenCalled();
  });

  it('will not delete one that is already deleted', async () => {
    const { service, prisma } = build({ actorRole: 'SUPERADMIN' });
    // The lookup filters deletedAt: null, so an already-removed row is simply
    // not found — which is the same answer as "not there".
    prisma.leaveRequest.findFirst.mockResolvedValue(null);
    await expect(service.deleteRequest(9, 30)).rejects.toThrow(/not found/i);
  });
});
