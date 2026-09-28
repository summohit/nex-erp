import { FieldVisitActivationService } from '../field-visits/requests/field-visit-activation.service';

/**
 * §Att10: back to your own shift when leave goes away.
 *
 * The decision this encodes: cancelling leave does NOT put somebody back on a
 * client visit. The trip released those days when the leave was approved, the
 * work was very likely re-planned around them, and quietly restoring it would
 * resurrect a plan that has moved on. They return to ordinary work instead.
 */

const RANGE = {
  employeeId: 60,
  companyId: 1,
  from: new Date('2026-10-01T00:00:00.000Z'),
  to: new Date('2026-10-03T00:00:00.000Z'),
};

function build(rows: any[]) {
  const tx: any = {
    shiftRosterEntry: {
      findMany: jest.fn().mockResolvedValue(rows),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  // Takes no constructor dependencies — it works on the transaction handed to it.
  const service = new FieldVisitActivationService();
  return { tx, service };
}

describe('returning somebody to their standing shift', () => {
  it('does nothing when the leave never touched a client visit', async () => {
    const { tx, service } = build([]);
    const touched = await service.restoreStandingShiftAfterLeave(tx, RANGE);
    expect(touched).toBe(0);
    expect(tx.shiftRosterEntry.deleteMany).not.toHaveBeenCalled();
    expect(tx.shiftRosterEntry.updateMany).not.toHaveBeenCalled();
  });

  /**
   * A cell that exists only to carry on-site details says nothing once they
   * are stripped — and an empty row is not the same as no row, because the
   * resolver reads any row as an override of the standing shift.
   */
  it('removes a cell that had no shift of its own', async () => {
    const { tx, service } = build([{ id: 1, shiftId: null }]);
    await service.restoreStandingShiftAfterLeave(tx, RANGE);
    expect(tx.shiftRosterEntry.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1] } } });
    expect(tx.shiftRosterEntry.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a cell that has a shift, clearing only the on-site details', async () => {
    const { tx, service } = build([{ id: 2, shiftId: 5 }]);
    await service.restoreStandingShiftAfterLeave(tx, RANGE);
    expect(tx.shiftRosterEntry.deleteMany).not.toHaveBeenCalled();
    expect(tx.shiftRosterEntry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [2] } },
      data: { projectId: null, address: null, startTime: null, endTime: null, note: null },
    });
  });

  it('handles both kinds in one range', async () => {
    const { tx, service } = build([
      { id: 1, shiftId: null },
      { id: 2, shiftId: 5 },
      { id: 3, shiftId: null },
    ]);
    const touched = await service.restoreStandingShiftAfterLeave(tx, RANGE);
    expect(touched).toBe(3);
    expect(tx.shiftRosterEntry.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1, 3] } } });
    expect(tx.shiftRosterEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [2] } } }),
    );
  });

  /**
   * The query is the guard: only cells carrying on-site residue are selected.
   * A deliberate day off, or a night shift somebody was rostered onto that
   * week, has nothing to do with the leave and is not this function's to undo.
   */
  it('only looks at cells carrying on-site details, within the leave dates', async () => {
    const { tx, service } = build([]);
    await service.restoreStandingShiftAfterLeave(tx, RANGE);
    const where = tx.shiftRosterEntry.findMany.mock.calls[0][0].where;
    expect(where.employeeId).toBe(60);
    expect(where.companyId).toBe(1);
    expect(where.OR).toEqual([
      { projectId: { not: null } },
      { address: { not: null } },
    ]);
    expect(where).not.toHaveProperty('isDayOff');
    expect(where.date).toBeDefined();
  });
});
