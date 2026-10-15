import { LeavesService } from './leaves.service';

/**
 * How many days a leave costs. From TKT-022: "6:even" (2nd and 4th Saturdays
 * off) was read as every Saturday off, so leave on a working 1st Saturday came
 * out as zero days and was refused.
 */
describe('leave working days', () => {
  let rosterRows: { date: Date; isDayOff: boolean; onsiteApprovalStatus?: string }[] = [];
  const service = Object.create(LeavesService.prototype) as any;
  service.prisma = { shiftRosterEntry: { findMany: jest.fn(async () => rosterRows) } };
  beforeEach(() => { rosterRows = []; });
  const days = (from: string, to: string, offs: string, holidays: string[] = [], half = false, shift: string | null = null) =>
    service.calculateWorkingDays(
      new Date(from), new Date(to), { id: 1, shift: { workingDays: shift }, branch: { weeklyOffs: offs } }, half, new Set(holidays),
    );

  it('counts a 1st Saturday as a working day when only even Saturdays are off', async () => {
    expect(await days('2026-10-03', '2026-10-03', '0:all,6:even')).toBe(1);
  });

  it('does not count a 2nd Saturday under the same rule', async () => {
    expect(await days('2026-10-10', '2026-10-10', '0:all,6:even')).toBe(0);
  });

  it('skips Sundays and holidays across a range', async () => {
    // Thu 1 – Mon 5 Oct: Fri 2 is a holiday, Sun 4 is off, Sat 3 is worked.
    expect(await days('2026-10-01', '2026-10-05', '0:all,6:even', ['2026-10-02'])).toBe(3);
  });

  it('treats a plain "0" as Sundays off', async () => {
    expect(await days('2026-10-04', '2026-10-04', '0')).toBe(0);
  });

  it('halves a single working day', async () => {
    expect(await days('2026-10-03', '2026-10-03', '0:all,6:even', [], true)).toBe(0.5);
  });

  it('follows the roster: a rostered Monday off is free, a rostered Sunday costs a day (15 Oct 2026)', async () => {
    const ALL_WEEK = 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday';
    rosterRows = [
      { date: new Date('2026-10-11T00:00:00Z'), isDayOff: false },
      { date: new Date('2026-10-12T00:00:00Z'), isDayOff: true },
    ];
    expect(await days('2026-10-11', '2026-10-12', '0:all,6:even', [], false, ALL_WEEK)).toBe(1);
  });
});
