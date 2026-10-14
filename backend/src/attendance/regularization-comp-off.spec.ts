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
    employee: { userId: 5, id: 10, companyId: 1 },
    status: 'PENDING',
  };
  const HR = { companyId: 1, role: 'HR', employeeId: 3 };

  // A plain working day on a 09:30–18:30 shift, 15 minutes' buffer, half-day after 13:30.
  const SHIFT = {
    source: 'STANDING', isDayOff: false, onsite: null, startTime: '09:30', endTime: '18:30',
    shift: { id: 6, name: 'Onsite Project', bufferTimeMinutes: 15, halfDayTime: '13:30', officeGeofence: false },
  };

  function make(existing: any, request: any = reg) {
    const prisma: any = {
      attendanceRegularization: {
        findUnique: jest.fn().mockResolvedValue(request),
        update: jest.fn().mockResolvedValue({ ...request, status: 'APPROVED' }),
      },
      employee: { findMany: jest.fn().mockResolvedValue([]) },
      attendance: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({ id: 77 }),
        update: jest.fn().mockResolvedValue({ id: existing?.id }),
      },
    };
    const notifications: any = {
      create: jest.fn(), notifyEmployees: jest.fn(), notifyUser: jest.fn(),
      createNotification: jest.fn().mockResolvedValue(undefined),
    };
    const roster: any = { getEffectiveShift: jest.fn().mockResolvedValue(SHIFT) };
    const service = new AttendanceService(prisma, notifications, roster, {} as any);
    jest.spyOn(service, 'isHoliday').mockResolvedValue(false);
    const grant = jest.spyOn(service as any, 'grantCompOffIfEligible').mockResolvedValue(undefined);
    return { service, prisma, grant, roster };
  }

  it('checks the new day for comp-off', async () => {
    const { service, grant } = make(null);
    await service.resolveRegularization(1, 99, 'APPROVED', undefined, HR).catch(() => {});
    expect(grant).toHaveBeenCalledWith(77);
  });

  it('checks an existing day it corrects', async () => {
    const { service, grant } = make({ id: 55, clockIn: null, clockOut: null });
    await service.resolveRegularization(1, 99, 'APPROVED', undefined, HR).catch(() => {});
    expect(grant).toHaveBeenCalledWith(55);
  });

  // Anyone could approve anyone's regularization — and approval writes
  // attendance and can credit comp-off.
  it('refuses somebody who is neither HR nor the manager', async () => {
    const { service, grant } = make(null);
    await expect(service.resolveRegularization(1, 99, 'APPROVED', undefined, { companyId: 1, role: 'EMPLOYEE', employeeId: 50 }))
      .rejects.toThrow(/Only HR/);
    expect(grant).not.toHaveBeenCalled();
  });

  it('refuses approving your own', async () => {
    const { service } = make(null);
    await expect(service.resolveRegularization(1, 99, 'APPROVED', undefined, { companyId: 1, role: 'HR', employeeId: 10 }))
      .rejects.toThrow(/your own/);
  });

  it('refuses another company', async () => {
    const { service } = make(null);
    await expect(service.resolveRegularization(1, 99, 'APPROVED', undefined, { companyId: 2, role: 'HR', employeeId: 3 }))
      .rejects.toThrow(/company/);
  });

  it('lets the manager of the person decide', async () => {
    const { service, prisma, grant } = make(null);
    prisma.employee.findMany.mockResolvedValueOnce([{ id: 10 }]).mockResolvedValue([]);
    await service.resolveRegularization(1, 99, 'APPROVED', undefined, { companyId: 1, role: 'EMPLOYEE', employeeId: 7 }).catch(() => {});
    expect(grant).toHaveBeenCalledWith(77);
  });

  // Amit Kumar's onsite days were HALF_DAY; approving corrected times left them
  // HALF_DAY because approval never re-scored the day.
  describe('re-scores the corrected day', () => {
    const onsiteDay = {
      ...reg, date: new Date('2026-10-06T00:00:00Z'),
      proposedClockIn: new Date('2026-10-06T09:25:00+05:30'), proposedClockOut: new Date('2026-10-06T18:40:00+05:30'),
    };
    const halfDay = { id: 51312, status: 'HALF_DAY', isLate: true, isEarlyLeave: true, clockIn: null, clockOut: null };

    it('turns a half day worked in full into PRESENT, on the shift in force that day', async () => {
      const { service, prisma } = make(halfDay, onsiteDay);
      await service.resolveRegularization(1, 99, 'APPROVED', undefined, HR);
      expect(prisma.attendance.update.mock.calls[0][0].data).toMatchObject({
        status: 'PRESENT', isLate: false, isEarlyLeave: false, shiftId: 6,
      });
    });

    it('keeps HALF_DAY when the corrected times still leave early', async () => {
      const { service, prisma } = make(halfDay, { ...onsiteDay, proposedClockOut: new Date('2026-10-06T15:00:00+05:30') });
      await service.resolveRegularization(1, 99, 'APPROVED', undefined, HR);
      expect(prisma.attendance.update.mock.calls[0][0].data).toMatchObject({ status: 'HALF_DAY', isEarlyLeave: true });
    });

    it('marks late without halving the day before the half-day boundary', async () => {
      const { service, prisma } = make(halfDay, { ...onsiteDay, proposedClockIn: new Date('2026-10-06T10:00:00+05:30') });
      await service.resolveRegularization(1, 99, 'APPROVED', undefined, HR);
      expect(prisma.attendance.update.mock.calls[0][0].data).toMatchObject({ status: 'PRESENT', isLate: true });
    });

    it('compares a clock-out after midnight with that day\'s shift end', async () => {
      const { service, prisma } = make(halfDay, { ...onsiteDay, proposedClockOut: new Date('2026-10-07T00:30:00+05:30') });
      await service.resolveRegularization(1, 99, 'APPROVED', undefined, HR);
      expect(prisma.attendance.update.mock.calls[0][0].data).toMatchObject({ status: 'PRESENT', isEarlyLeave: false });
    });

    it('leaves a leave day\'s status alone', async () => {
      const { service, prisma, roster } = make({ ...halfDay, status: 'ON_LEAVE' }, onsiteDay);
      await service.resolveRegularization(1, 99, 'APPROVED', undefined, HR);
      expect(roster.getEffectiveShift).not.toHaveBeenCalled();
      expect(prisma.attendance.update.mock.calls[0][0].data.status).toBeUndefined();
    });
  });

  it('credits nothing when the request is rejected', async () => {
    const { service, grant } = make(null);
    await service.resolveRegularization(1, 99, 'REJECTED', 'No proof', HR).catch(() => {});
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
