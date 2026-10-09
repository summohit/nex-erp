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
