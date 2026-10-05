import { LeavesService } from './leaves.service';

/**
 * How many days a leave costs. From TKT-022: "6:even" (2nd and 4th Saturdays
 * off) was read as every Saturday off, so leave on a working 1st Saturday came
 * out as zero days and was refused.
 */
describe('leave working days', () => {
  const service = Object.create(LeavesService.prototype) as any;
  const days = (from: string, to: string, offs: string, holidays: string[] = [], half = false) =>
    service.calculateWorkingDays(new Date(from), new Date(to), offs, half, new Set(holidays));

  it('counts a 1st Saturday as a working day when only even Saturdays are off', () => {
    expect(days('2026-10-03', '2026-10-03', '0:all,6:even')).toBe(1);
  });

  it('does not count a 2nd Saturday under the same rule', () => {
    expect(days('2026-10-10', '2026-10-10', '0:all,6:even')).toBe(0);
  });

  it('skips Sundays and holidays across a range', () => {
    // Thu 1 – Mon 5 Oct: Fri 2 is a holiday, Sun 4 is off, Sat 3 is worked.
    expect(days('2026-10-01', '2026-10-05', '0:all,6:even', ['2026-10-02'])).toBe(3);
  });

  it('treats a plain "0" as Sundays off', () => {
    expect(days('2026-10-04', '2026-10-04', '0')).toBe(0);
  });

  it('halves a single working day', () => {
    expect(days('2026-10-03', '2026-10-03', '0:all,6:even', [], true)).toBe(0.5);
  });
});
