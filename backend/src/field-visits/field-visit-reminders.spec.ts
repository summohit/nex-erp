import { FieldVisitRemindersCron } from './field-visit-reminders.cron';

/**
 * §12's reminders, and the sweep that closes a trip (§3).
 *
 * Times are IST wall-clock, so every instant below is built as UTC minus 5:30
 * — the same way the shift reminders are tested.
 */
describe('field visit reminders', () => {
  const IST = 5.5 * 60 * 60 * 1000;
  /** A real instant for the given IST time on 24 September 2026. */
  const ist = (hh: number, mm = 0) => new Date(Date.UTC(2026, 8, 24, hh, mm) - IST);

  const DAY = (over: any = {}) => ({
    id: 44, employeeId: 60, clockInTime: null, clockOutTime: null,
    employee: { userId: 500, companyId: 1 },
    request: {
      requestNumber: 'FVR-0009', location: 'Client Site – Delhi',
      startTime: '09:00', endTime: '18:00', geofenceRadiusM: 500,
    },
    ...over,
  });

  function make(days: any[] = [DAY()], finished: any[] = []) {
    const prisma: any = {
      fieldVisitAttendance: {
        findMany: jest.fn().mockResolvedValue(days),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      fieldVisitRequest: {
        findMany: jest.fn().mockResolvedValue(finished),
        update: jest.fn().mockResolvedValue({}),
      },
      fieldVisitRequestActivity: { create: jest.fn().mockResolvedValue({}) },
      shiftReminderLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));
    const notifications: any = { createNotification: jest.fn().mockResolvedValue({}) };
    return { cron: new FieldVisitRemindersCron(prisma, notifications), prisma, notifications };
  }

  const titles = (n: any) => n.createNotification.mock.calls.map((c: any[]) => c[1]);

  it('tells people the evening before', async () => {
    const { cron, notifications, prisma } = make();
    await cron.run(ist(18, 0));

    expect(titles(notifications)).toContain('Field visit tomorrow');
    // Claimed before sending, so a crash cannot produce a second one.
    expect(prisma.shiftReminderLog.create.mock.calls[0][0].data.kind).toBe('FV_TOMORROW');
  });

  it('nudges somebody who has not clocked in, shortly before the start', async () => {
    const { cron, notifications } = make();
    await cron.run(ist(8, 45));
    expect(titles(notifications)).toContain('Field visit starts shortly');
  });

  it('says nothing to somebody already clocked in', async () => {
    const { cron, notifications } = make([DAY({ clockInTime: new Date() })]);
    await cron.run(ist(8, 45));
    expect(titles(notifications)).not.toContain('Field visit starts shortly');
  });

  it('reminds an open day to clock out before the end', async () => {
    const { cron, notifications } = make([DAY({ clockInTime: new Date() })]);
    await cron.run(ist(17, 50));
    expect(titles(notifications)).toContain('Remember to clock out');
  });

  it('says nothing once the day is closed', async () => {
    const { cron, notifications } = make([
      DAY({ clockInTime: new Date(), clockOutTime: new Date() }),
    ]);
    await cron.run(ist(17, 50));
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('asks only about people still expected — not those on leave or done', async () => {
    const { cron, prisma } = make();
    await cron.run(ist(8, 45));
    expect(prisma.fieldVisitAttendance.findMany.mock.calls[0][0].where.status)
      .toEqual({ in: ['SCHEDULED', 'IN_PROGRESS'] });
  });

  it('sends nothing at a minute nothing is due', async () => {
    const { cron, notifications } = make();
    await cron.run(ist(13, 17));
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });
});

describe('closing trips that have run', () => {
  const IST = 5.5 * 60 * 60 * 1000;
  const ist = (hh: number, mm = 0) => new Date(Date.UTC(2026, 8, 24, hh, mm) - IST);

  function make(finished: any[]) {
    const prisma: any = {
      fieldVisitAttendance: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      fieldVisitRequest: {
        findMany: jest.fn().mockResolvedValue(finished),
        update: jest.fn().mockResolvedValue({}),
      },
      fieldVisitRequestActivity: { create: jest.fn().mockResolvedValue({}) },
      shiftReminderLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));
    return { cron: new FieldVisitRemindersCron(prisma, { createNotification: jest.fn() } as any), prisma };
  }

  it('closes an approved trip whose last day has passed', async () => {
    const { cron, prisma } = make([{ id: 9, requestNumber: 'FVR-0009', raisedById: 71 }]);
    await cron.run(ist(0, 30));

    expect(prisma.fieldVisitRequest.update).toHaveBeenCalledWith({
      where: { id: 9 }, data: { status: 'COMPLETED' },
    });
    // A day nobody clocked does not keep looking like it is still coming.
    expect(prisma.fieldVisitAttendance.updateMany).toHaveBeenCalledWith({
      where: { requestId: 9, status: 'SCHEDULED' },
      data: { status: 'COMPLETED' },
    });
    expect(prisma.fieldVisitRequestActivity.create.mock.calls[0][0].data.action).toBe('COMPLETED');
  });

  it('only looks at approved trips that have ended', async () => {
    const { cron, prisma } = make([]);
    await cron.run(ist(0, 30));
    const where = prisma.fieldVisitRequest.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('APPROVED');
    expect(where.endDate.lt).toBeInstanceOf(Date);
  });

  it('does not run the sweep at other times of day', async () => {
    const { cron, prisma } = make([{ id: 9, requestNumber: 'FVR-0009', raisedById: 71 }]);
    await cron.run(ist(11, 0));
    expect(prisma.fieldVisitRequest.update).not.toHaveBeenCalled();
  });
});
