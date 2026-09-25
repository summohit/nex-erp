import { BadRequestException } from '@nestjs/common';
import { FieldVisitActivationService, ActivationRequest } from './field-visit-activation.service';

/**
 * §4 and §14: approving the trip is what creates the work.
 *
 * Three people, three days, two tasks — the spec's own example shape. What
 * these tests hold down is that every person gets every task, that a day
 * already clocked is never disturbed by a second approval, and that the
 * roster is refused rather than overwritten when it disagrees, because a
 * roster entry is what later exempts somebody from the office geofence.
 */

const MEMBERS = [60, 61, 62];

const REQUEST: ActivationRequest = {
  id: 9,
  requestNumber: 'FVR-0009',
  companyId: 1,
  projectId: 3,
  raisedById: 71,
  location: 'Client Site – Delhi',
  startDate: new Date('2026-09-22T00:00:00.000Z'),
  endDate: new Date('2026-09-24T00:00:00.000Z'),
  startTime: '09:00',
  endTime: '18:00',
  members: MEMBERS.map((employeeId) => ({ employeeId })),
  tasks: [
    { id: 1, name: 'Site Inspection', description: null, position: 0 },
    { id: 2, name: 'Network Configuration', description: 'Switches and AP', position: 1 },
  ],
};

function makeTx(over: any = {}) {
  const tx: any = {
    holiday: { findMany: jest.fn().mockResolvedValue([]) },
    fieldVisitAttendance: {
      createMany: jest.fn().mockImplementation((a: any) => Promise.resolve({ count: a.data.length })),
      deleteMany: jest.fn().mockResolvedValue({ count: 9 }),
    },
    shiftRosterEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    employee: {
      findMany: jest.fn().mockResolvedValue([
        { id: 60, firstName: 'Asha', lastName: 'Rao' },
        { id: 61, firstName: 'Vikram', lastName: 'Singh' },
      ]),
    },
    project: { findFirst: jest.fn().mockResolvedValue({ id: 3, key: 'ACME' }) },
    board: { findFirst: jest.fn().mockResolvedValue({ columns: [{ id: 5 }] }) },
    issue: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ position: 0 }),
      count: jest.fn().mockResolvedValue(4),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 6 }),
    },
    ...over,
  };
  return { tx, service: new FieldVisitActivationService() };
}

const created = (mock: jest.Mock) => mock.mock.calls.map((c: any[]) => c[0].data);

describe('the attendance schedule', () => {
  it('writes one row per person per day', async () => {
    const { service, tx } = makeTx();
    const result = await service.activate(tx, REQUEST, 90);

    // Three people over 22–24 September inclusive.
    expect(result.attendanceDays).toBe(9);
    const rows = tx.fieldVisitAttendance.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.visitDate.toISOString().slice(0, 10))).toEqual([
      '2026-09-22', '2026-09-22', '2026-09-22',
      '2026-09-23', '2026-09-23', '2026-09-23',
      '2026-09-24', '2026-09-24', '2026-09-24',
    ]);
    expect(rows.every((r: any) => r.status === 'SCHEDULED')).toBe(true);
  });

  it('flags a company holiday inside the trip instead of skipping the day', async () => {
    const { service, tx } = makeTx({
      holiday: { findMany: jest.fn().mockResolvedValue([{ date: new Date('2026-09-23T00:00:00.000Z') }]) },
    });
    await service.activate(tx, REQUEST, 90);

    const rows = tx.fieldVisitAttendance.createMany.mock.calls[0][0].data;
    const holidayRows = rows.filter((r: any) => r.isHoliday);
    expect(holidayRows).toHaveLength(3);
    expect(holidayRows.every((r: any) => r.visitDate.toISOString().startsWith('2026-09-23'))).toBe(true);
  });

  it('leans on the unique index so a second approval adds only what is missing', async () => {
    const { service, tx } = makeTx();
    await service.activate(tx, REQUEST, 90);
    expect(tx.fieldVisitAttendance.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });
});

describe('the tasks', () => {
  it('gives every task to every person', async () => {
    const { service, tx } = makeTx();
    const result = await service.activate(tx, REQUEST, 90);

    expect(result.issues).toBe(6);
    const issues = created(tx.issue.create);
    expect(issues.map((i: any) => `${i.title}|${i.assigneeId}`)).toEqual([
      'Site Inspection|60', 'Site Inspection|61', 'Site Inspection|62',
      'Network Configuration|60', 'Network Configuration|61', 'Network Configuration|62',
    ]);
  });

  it('numbers the keys on from what the project already has', async () => {
    const { service, tx } = makeTx();
    await service.activate(tx, REQUEST, 90);
    expect(created(tx.issue.create).map((i: any) => i.key))
      .toEqual(['ACME-5', 'ACME-6', 'ACME-7', 'ACME-8', 'ACME-9', 'ACME-10']);
  });

  it('dates each task to the trip and points it back at the request', async () => {
    const { service, tx } = makeTx();
    await service.activate(tx, REQUEST, 90);

    const first = created(tx.issue.create)[0];
    expect(first.startDate).toEqual(REQUEST.startDate);
    expect(first.dueDate).toEqual(REQUEST.endDate);
    expect(first.fieldVisitRequestId).toBe(9);
    expect(first.reporterId).toBe(71);
    expect(first.columnId).toBe(5);
  });

  it('looks for the top of the column within this project only', async () => {
    const { service, tx } = makeTx({ board: { findFirst: jest.fn().mockResolvedValue(null) } });
    await service.activate(tx, REQUEST, 90);
    // A project with no board leaves columnId null, and an unscoped read for
    // `columnId: null` would order these cards against another company's.
    expect(tx.issue.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 3, companyId: 1, columnId: null },
    }));
  });

  it('adds only the missing ones when an approved trip is approved again', async () => {
    const { service, tx } = makeTx({
      issue: {
        ...makeTx().tx.issue,
        findMany: jest.fn().mockResolvedValue([
          { assigneeId: 60, title: 'Site Inspection' },
          { assigneeId: 61, title: 'Site Inspection' },
        ]),
      },
    });
    const result = await service.activate(tx, REQUEST, 90);
    expect(result.issues).toBe(4);
    expect(created(tx.issue.create).map((i: any) => `${i.title}|${i.assigneeId}`))
      .not.toContain('Site Inspection|60');
  });

  it('walks the key up when another task takes the number first', async () => {
    const { service, tx } = makeTx();
    const clash = Object.assign(new Error('unique'), { code: 'P2002' });
    tx.issue.create.mockRejectedValueOnce(clash);

    await service.activate(tx, REQUEST, 90);
    const keys = created(tx.issue.create).map((i: any) => i.key);
    expect(keys[0]).toBe('ACME-5');
    expect(keys[1]).toBe('ACME-6');
    expect(keys[2]).toBe('ACME-7');
  });
});

describe('the roster', () => {
  it('rosters every person on every day, at the site and the requested hours', async () => {
    const { service, tx } = makeTx();
    const result = await service.activate(tx, REQUEST, 90);

    expect(result.rosterEntries).toBe(9);
    const rows = created(tx.shiftRosterEntry.create);
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({
      employeeId: 60, projectId: 3, address: 'Client Site – Delhi',
      startTime: '09:00', endTime: '18:00',
      isDayOff: false, onsiteApprovalStatus: 'NONE',
      note: 'Field visit FVR-0009',
      // Null so the employee keeps the shift they are actually on.
      shiftId: null,
    });
  });

  it('adopts an empty roster cell, keeping the shift already on it', async () => {
    const { service, tx } = makeTx({
      shiftRosterEntry: {
        ...makeTx().tx.shiftRosterEntry,
        findMany: jest.fn().mockResolvedValue([
          { id: 77, employeeId: 60, date: new Date('2026-09-22T00:00:00.000Z'), isDayOff: false, projectId: null, shiftId: 2 },
        ]),
      },
    });
    await service.activate(tx, REQUEST, 90);

    expect(tx.shiftRosterEntry.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: expect.objectContaining({ projectId: 3, startTime: '09:00', note: 'Field visit FVR-0009' }),
    });
    // The other eight cells were empty, so they are new rows.
    expect(tx.shiftRosterEntry.create).toHaveBeenCalledTimes(8);
  });

  it('refuses to stamp over a rostered day off, and says whose', async () => {
    const { service, tx } = makeTx({
      shiftRosterEntry: {
        ...makeTx().tx.shiftRosterEntry,
        findMany: jest.fn().mockResolvedValue([
          { id: 77, employeeId: 60, date: new Date('2026-09-23T00:00:00.000Z'), isDayOff: true, projectId: null, shiftId: null },
        ]),
      },
    });

    await expect(service.activate(tx, REQUEST, 90))
      .rejects.toThrow(/Asha Rao is rostered off on 2026-09-23/);
    expect(tx.shiftRosterEntry.create).not.toHaveBeenCalled();
  });

  it('refuses to move somebody off another project site', async () => {
    const { service, tx } = makeTx({
      shiftRosterEntry: {
        ...makeTx().tx.shiftRosterEntry,
        findMany: jest.fn().mockResolvedValue([
          { id: 78, employeeId: 61, date: new Date('2026-09-22T00:00:00.000Z'), isDayOff: false, projectId: 99, shiftId: 2 },
        ]),
      },
    });

    await expect(service.activate(tx, REQUEST, 90))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.activate(tx, REQUEST, 90))
      .rejects.toThrow(/Vikram Singh is already on site for another project on 2026-09-22/);
  });

  it('is content with the same trip being re-approved onto its own days', async () => {
    const { service, tx } = makeTx({
      shiftRosterEntry: {
        ...makeTx().tx.shiftRosterEntry,
        findMany: jest.fn().mockResolvedValue([
          { id: 79, employeeId: 62, date: new Date('2026-09-24T00:00:00.000Z'), isDayOff: false, projectId: 3, shiftId: null },
        ]),
      },
    });
    await expect(service.activate(tx, REQUEST, 90)).resolves.toMatchObject({ rosterEntries: 9 });
  });
});

describe('calling the trip off', () => {
  it('deletes the rows it created and hands back the ones it adopted', async () => {
    const { service, tx } = makeTx({
      shiftRosterEntry: {
        ...makeTx().tx.shiftRosterEntry,
        findMany: jest.fn().mockResolvedValue([
          { id: 77, shiftId: null },
          { id: 78, shiftId: null },
          { id: 79, shiftId: 2 },
        ]),
      },
    });

    const undone = await service.deactivate(tx, REQUEST, 71);

    expect(tx.shiftRosterEntry.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [77, 78] } } });
    expect(tx.shiftRosterEntry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [79] } },
      data: { projectId: null, address: null, startTime: null, endTime: null, note: null },
    });
    expect(undone.rosterEntries).toBe(3);
  });

  it('keeps days that were actually clocked', async () => {
    const { service, tx } = makeTx();
    await service.deactivate(tx, REQUEST, 71);
    expect(tx.fieldVisitAttendance.deleteMany).toHaveBeenCalledWith({
      where: { requestId: 9, clockInTime: null },
    });
  });

  it('archives the tasks rather than deleting work that may have been logged', async () => {
    const { service, tx } = makeTx();
    const undone = await service.deactivate(tx, REQUEST, 71);
    expect(tx.issue.updateMany).toHaveBeenCalledWith({
      where: { fieldVisitRequestId: 9, isArchived: false },
      data: { isArchived: true },
    });
    expect(undone.issues).toBe(6);
  });

  it('touches only the roster rows this trip owns, including a dropped member', async () => {
    const { service, tx } = makeTx();
    await service.deactivate(tx, REQUEST, 71);
    // The note carries the request number, so it finds every row this trip
    // wrote — including one for somebody since removed from the members list,
    // whose roster entry would otherwise be stranded as on-site.
    expect(tx.shiftRosterEntry.findMany.mock.calls[0][0].where)
      .toEqual({ companyId: 1, note: 'Field visit FVR-0009' });
  });
});

describe('reconciling after a change is approved (§10)', () => {
  const TRIMMED: ActivationRequest = {
    ...REQUEST,
    // A day shorter, one person swapped, one task dropped.
    endDate: new Date('2026-09-23T00:00:00.000Z'),
    members: [{ employeeId: 60 }, { employeeId: 99 }],
    tasks: [{ id: 1, name: 'Site Inspection', description: null, position: 0 }],
  };

  function makeReconcileTx(over: any = {}) {
    return makeTx({
      fieldVisitAttendance: {
        findMany: jest.fn().mockResolvedValue([
          // Kept: 60 is still going, 22nd is still in range.
          { id: 1, employeeId: 60, visitDate: new Date('2026-09-22T00:00:00.000Z') },
          // Dropped: the 24th is no longer part of the trip.
          { id: 2, employeeId: 60, visitDate: new Date('2026-09-24T00:00:00.000Z') },
          // Dropped: 61 is off the trip.
          { id: 3, employeeId: 61, visitDate: new Date('2026-09-22T00:00:00.000Z') },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        createMany: jest.fn().mockImplementation((a: any) => Promise.resolve({ count: a.data.length })),
      },
      issue: {
        findMany: jest.fn().mockResolvedValue([
          { id: 11, assigneeId: 60, title: 'Site Inspection' },
          { id: 12, assigneeId: 60, title: 'Network Configuration' },
          { id: 13, assigneeId: 61, title: 'Site Inspection' },
        ]),
        findFirst: jest.fn().mockResolvedValue({ position: 0 }),
        count: jest.fn().mockResolvedValue(4),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      ...over,
    });
  }

  it('drops the days the trip no longer covers, and the people no longer on it', async () => {
    const { service, tx } = makeReconcileTx();
    const result = await service.reconcile(tx, TRIMMED, 90);

    expect(tx.fieldVisitAttendance.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2, 3] } } });
    expect(result.releasedDays).toBe(2);
  });

  it('never drops a day somebody already clocked', async () => {
    const { service, tx } = makeReconcileTx();
    await service.reconcile(tx, TRIMMED, 90);
    // The candidates are read with clockInTime null — a clocked day is not
    // eligible to be released, whatever the change did to the range.
    expect(tx.fieldVisitAttendance.findMany.mock.calls[0][0].where)
      .toEqual({ requestId: 9, clockInTime: null });
  });

  it('archives tasks for dropped people and dropped work', async () => {
    const { service, tx } = makeReconcileTx();
    const result = await service.reconcile(tx, TRIMMED, 90);

    // 12 is Network Configuration, which is off the list; 13 belongs to 61,
    // who is off the trip. 11 survives both tests.
    expect(tx.issue.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [12, 13] } },
      data: { isArchived: true },
    });
    expect(result.archivedTasks).toBe(2);
  });

  it('hands back the roster cells the trip has let go', async () => {
    const { service, tx } = makeReconcileTx({
      shiftRosterEntry: {
        ...makeTx().tx.shiftRosterEntry,
        findMany: jest.fn().mockResolvedValue([
          { id: 70, employeeId: 60, date: new Date('2026-09-22T00:00:00.000Z'), shiftId: null },
          { id: 71, employeeId: 60, date: new Date('2026-09-24T00:00:00.000Z'), shiftId: null },
          { id: 72, employeeId: 61, date: new Date('2026-09-22T00:00:00.000Z'), shiftId: 2 },
        ]),
      },
    });

    await service.reconcile(tx, TRIMMED, 90);
    // 71 is a day off the end, 72 belongs to somebody off the trip. 70 stays.
    expect(tx.shiftRosterEntry.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [71] } } });
    expect(tx.shiftRosterEntry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [72] } },
      data: { projectId: null, address: null, startTime: null, endTime: null, note: null },
    });
  });

  it('adds what the new shape asks for that is not there yet', async () => {
    const { service, tx } = makeReconcileTx();
    const result = await service.reconcile(tx, TRIMMED, 90);

    // The person added gets the surviving task; the one already holding it
    // does not get a second copy.
    expect(created(tx.issue.create).map((i: any) => `${i.title}|${i.assigneeId}`))
      .toEqual(['Site Inspection|99']);
    expect(result.issues).toBe(1);
  });

  it('leaves everything alone when the change moved nothing it owns', async () => {
    const { service, tx } = makeReconcileTx({
      fieldVisitAttendance: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, employeeId: 60, visitDate: new Date('2026-09-22T00:00:00.000Z') },
        ]),
        deleteMany: jest.fn(),
        createMany: jest.fn().mockImplementation((a: any) => Promise.resolve({ count: a.data.length })),
      },
      issue: {
        findMany: jest.fn().mockResolvedValue([{ id: 11, assigneeId: 60, title: 'Site Inspection' }]),
        findFirst: jest.fn().mockResolvedValue({ position: 0 }),
        count: jest.fn().mockResolvedValue(4),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
    });

    const result = await service.reconcile(
      tx,
      { ...TRIMMED, members: [{ employeeId: 60 }] },
      90,
    );
    expect(tx.fieldVisitAttendance.deleteMany).not.toHaveBeenCalled();
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(result.releasedDays).toBe(0);
    expect(result.archivedTasks).toBe(0);
  });
});
