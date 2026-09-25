import { FieldVisitActivationService } from './field-visit-activation.service';

/**
 * §9: an employee assigned to an approved field visit cannot simply take the
 * day off.
 *
 * The rule has two halves and they pull in opposite directions. Before the
 * leave is filed, the trip is a reason for the approver to think twice — not a
 * reason to refuse somebody who is ill. After it is approved, the trip has to
 * let those days go, or the roster still says they are at a client site on a
 * day they are on leave, and the two systems disagree about where they are.
 */

const LEAVE = {
  employeeId: 60,
  companyId: 1,
  from: new Date('2026-09-23T00:00:00.000Z'),
  to: new Date('2026-09-23T00:00:00.000Z'),
  actorId: 90,
};

const DAY = {
  id: 44,
  visitDate: new Date('2026-09-23T00:00:00.000Z'),
  request: { id: 9, requestNumber: 'FVR-0009', raisedById: 71, location: 'Client Site – Delhi' },
};

function makeTx(over: any = {}) {
  const tx: any = {
    fieldVisitAttendance: {
      findMany: jest.fn().mockResolvedValue([DAY]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      // Two other days of the trip are left.
      count: jest.fn().mockResolvedValue(2),
    },
    fieldVisitRequestActivity: {
      create: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
    },
    shiftRosterEntry: {
      findMany: jest.fn().mockResolvedValue([{ id: 77, shiftId: null }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    issue: { updateMany: jest.fn().mockResolvedValue({ count: 4 }) },
    ...over,
  };
  return { tx, service: new FieldVisitActivationService() };
}

describe('warning the approver', () => {
  it('reports the trip, the site and how many days the leave would take', async () => {
    const { service, tx } = makeTx({
      fieldVisitAttendance: {
        findMany: jest.fn().mockResolvedValue([
          DAY,
          { ...DAY, id: 45, visitDate: new Date('2026-09-24T00:00:00.000Z') },
        ]),
      },
    });

    const conflicts = await service.conflictsFor(
      tx, 60, 1, new Date('2026-09-23'), new Date('2026-09-24'),
    );
    expect(conflicts).toEqual([{
      requestNumber: 'FVR-0009',
      location: 'Client Site – Delhi',
      days: 2,
      dates: ['2026-09-23', '2026-09-24'],
    }]);
  });

  it('asks only about approved trips', async () => {
    const { service, tx } = makeTx();
    await service.conflictsFor(tx, 60, 1, new Date('2026-09-23'), new Date('2026-09-23'));
    expect(tx.fieldVisitAttendance.findMany.mock.calls[0][0].where.request)
      .toEqual({ status: 'APPROVED' });
  });

  it('says nothing when the days are free', async () => {
    const { service, tx } = makeTx({
      fieldVisitAttendance: { findMany: jest.fn().mockResolvedValue([]) },
    });
    expect(await service.conflictsFor(tx, 60, 1, new Date('2026-09-23'), new Date('2026-09-23')))
      .toEqual([]);
  });

  it('reads a leave date with a time on it as the calendar day', async () => {
    const { service, tx } = makeTx();
    await service.conflictsFor(
      tx, 60, 1,
      new Date('2026-09-23T18:30:00.000Z'), new Date('2026-09-23T18:30:00.000Z'),
    );
    const { visitDate } = tx.fieldVisitAttendance.findMany.mock.calls[0][0].where;
    expect(visitDate.gte.toISOString()).toBe('2026-09-23T00:00:00.000Z');
    expect(visitDate.lte.toISOString()).toBe('2026-09-23T00:00:00.000Z');
  });
});

describe('releasing the days once leave is approved', () => {
  it('drops the day and hands back the roster cell', async () => {
    const { service, tx } = makeTx();
    const released = await service.releaseDaysForLeave(tx, LEAVE);

    expect(tx.fieldVisitAttendance.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [44] } },
      data: { status: 'ON_LEAVE' },
    });
    expect(tx.fieldVisitAttendance.deleteMany).not.toHaveBeenCalled();
    expect(tx.shiftRosterEntry.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [77] } } });
    expect(released).toEqual([{
      requestId: 9, requestNumber: 'FVR-0009', raisedById: 71, days: 1, archivedTasks: 0,
    }]);
  });

  it('never touches a day that was already clocked', async () => {
    const { service, tx } = makeTx();
    await service.releaseDaysForLeave(tx, LEAVE);
    // Somebody was at the site that day; leave approved afterwards does not
    // unmake the attendance.
    expect(tx.fieldVisitAttendance.findMany.mock.calls[0][0].where.clockInTime).toBeNull();
    // Nor is a day already covered by leave released a second time.
    expect(tx.fieldVisitAttendance.findMany.mock.calls[0][0].where.status)
      .toEqual({ in: ['SCHEDULED', 'IN_PROGRESS'] });
  });

  it('leaves the tasks alone when part of the trip remains', async () => {
    const { service, tx } = makeTx();
    const [trip] = await service.releaseDaysForLeave(tx, LEAVE);
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(trip.archivedTasks).toBe(0);
  });

  it('archives their tasks when the leave swallows the whole trip', async () => {
    const { service, tx } = makeTx({
      fieldVisitAttendance: {
        findMany: jest.fn().mockResolvedValue([DAY]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
    });

    const [trip] = await service.releaseDaysForLeave(tx, LEAVE);
    expect(tx.issue.updateMany).toHaveBeenCalledWith({
      where: { fieldVisitRequestId: 9, assigneeId: 60, isArchived: false },
      data: { isArchived: true },
    });
    expect(trip.archivedTasks).toBe(4);
  });

  it('records it on the trip, so the audit trail says why a day vanished', async () => {
    const { service, tx } = makeTx();
    await service.releaseDaysForLeave(tx, LEAVE);
    expect(tx.fieldVisitRequestActivity.create.mock.calls[0][0].data).toMatchObject({
      requestId: 9,
      action: 'MEMBER_ON_LEAVE',
      actorId: 90,
    });
    expect(tx.fieldVisitRequestActivity.create.mock.calls[0][0].data.detail)
      .toContain('1 day(s) released');
  });

  it('keeps the day for a half-day leave, and notes it instead', async () => {
    const { service, tx } = makeTx();
    const [trip] = await service.releaseDaysForLeave(tx, { ...LEAVE, isHalfDay: true });

    // They are still expected on site for the other half.
    expect(tx.fieldVisitAttendance.updateMany).not.toHaveBeenCalled();
    expect(tx.shiftRosterEntry.deleteMany).not.toHaveBeenCalled();
    expect(tx.fieldVisitRequestActivity.create.mock.calls[0][0].data.action).toBe('MEMBER_HALF_DAY');
    expect(trip.days).toBe(0);
  });

  it('takes days off each trip separately when the leave spans two', async () => {
    const { service, tx } = makeTx({
      fieldVisitAttendance: {
        findMany: jest.fn().mockResolvedValue([
          DAY,
          {
            id: 50, visitDate: new Date('2026-09-25T00:00:00.000Z'),
            request: { id: 10, requestNumber: 'FVR-0010', raisedById: 72, location: 'Client Site – Noida' },
          },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
    });

    const released = await service.releaseDaysForLeave(tx, LEAVE);
    expect(released.map((r) => r.requestNumber)).toEqual(['FVR-0009', 'FVR-0010']);
    expect(tx.fieldVisitAttendance.updateMany).toHaveBeenCalledTimes(2);
  });

  it('does nothing at all when the leave touches no trip', async () => {
    const { service, tx } = makeTx({
      fieldVisitAttendance: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(), updateMany: jest.fn(), count: jest.fn(),
      },
    });
    expect(await service.releaseDaysForLeave(tx, LEAVE)).toEqual([]);
    expect(tx.fieldVisitRequestActivity.create).not.toHaveBeenCalled();
  });
});
