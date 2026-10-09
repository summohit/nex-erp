import { AttendanceService } from './attendance.service';

/**
 * Nitin worked 12 Jul, 27 Sep and 2 Oct — two Sundays and a holiday — but
 * could not clock in. Regularizing the days recorded the attendance and not
 * the comp-off, because only a live clock-out ever credited it.
 */
describe('approving a regularization', () => {
  const reg = {
    id: 1, employeeId: 10, date: new Date('2026-09-27T00:00:00Z'),
    proposedClockIn: new Date('2026-09-27T04:00:00Z'), proposedClockOut: new Date('2026-09-27T13:00:00Z'),
    employee: { userId: 5 },
  };

  function make(existing: any) {
    const prisma: any = {
      attendanceRegularization: {
        findUnique: jest.fn().mockResolvedValue(reg),
        update: jest.fn().mockResolvedValue({ ...reg, status: 'APPROVED' }),
      },
      attendance: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({ id: 77 }),
        update: jest.fn().mockResolvedValue({ id: existing?.id }),
      },
    };
    const notifications: any = { create: jest.fn(), notifyEmployees: jest.fn(), notifyUser: jest.fn() };
    const service = new AttendanceService(prisma, notifications, {} as any, {} as any);
    const grant = jest.spyOn(service as any, 'grantCompOffIfEligible').mockResolvedValue(undefined);
    return { service, prisma, grant };
  }

  it('checks the new day for comp-off', async () => {
    const { service, grant } = make(null);
    await service.resolveRegularization(1, 99, 'APPROVED').catch(() => {});
    expect(grant).toHaveBeenCalledWith(77);
  });

  it('checks an existing day it corrects', async () => {
    const { service, grant } = make({ id: 55, clockIn: null, clockOut: null });
    await service.resolveRegularization(1, 99, 'APPROVED').catch(() => {});
    expect(grant).toHaveBeenCalledWith(55);
  });

  it('credits nothing when the request is rejected', async () => {
    const { service, grant } = make(null);
    await service.resolveRegularization(1, 99, 'REJECTED', 'No proof').catch(() => {});
    expect(grant).not.toHaveBeenCalled();
  });
});

describe('requesting several days at once', () => {
  function make() {
    const created: any[] = [];
    const prisma: any = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 10, companyId: 1, firstName: 'Nitin', lastName: 'C', manager: null }) },
      attendanceRegularization: { create: jest.fn((a: any) => { created.push(a.data); return a.data; }) },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const notifications: any = { notifyApprovers: jest.fn().mockResolvedValue(undefined) };
    return { service: new AttendanceService(prisma, notifications, {} as any, {} as any), created, notifications };
  }

  it('saves one row per day, with one reason and one alert', async () => {
    const { service, created, notifications } = make();
    await service.requestRegularization(5, {
      reason: 'Worked on non-working days',
      entries: [
        { date: '2026-07-12', proposedClockIn: '2026-07-12T09:30:00+05:30', proposedClockOut: '2026-07-12T18:30:00+05:30' },
        { date: '2026-09-27' },
        { date: '2026-10-02' },
      ],
    });
    expect(created.map((c) => c.date.toISOString().slice(0, 10))).toEqual(['2026-07-12', '2026-09-27', '2026-10-02']);
    expect(created.every((c) => c.reason === 'Worked on non-working days')).toBe(true);
    expect(created[0].proposedClockIn.toISOString()).toBe('2026-07-12T04:00:00.000Z');
    expect(notifications.notifyApprovers).toHaveBeenCalledTimes(1);
    expect(notifications.notifyApprovers.mock.calls[0][0].message).toMatch(/3 days/);
  });

  it('refuses the same day twice', async () => {
    const { service } = make();
    await expect(service.requestRegularization(5, { reason: 'x', entries: [{ date: '2026-09-27' }, { date: '2026-09-27' }] }))
      .rejects.toThrow(/twice/);
  });

  it('refuses a clock-out before the clock-in', async () => {
    const { service } = make();
    await expect(service.requestRegularization(5, {
      reason: 'x', entries: [{ date: '2026-09-27', proposedClockIn: '2026-09-27T18:00:00+05:30', proposedClockOut: '2026-09-27T09:00:00+05:30' }],
    })).rejects.toThrow(/after clock-in/);
  });

  it('still takes the single-day form', async () => {
    const { service, created } = make();
    await service.requestRegularization(5, { date: '2026-09-27', reason: 'Forgot' });
    expect(created).toHaveLength(1);
  });
});
