import { personalDaysOff, isBranchWeeklyOff } from './weekly-offs';
import { isRestDay } from './rest-day';

/** The person's own weekly off (21 Oct 2026) wins over shift and branch. */
describe('personalDaysOff', () => {
  const sunday = new Date('2026-11-01T00:00:00Z');
  const monday = new Date('2026-11-02T00:00:00Z');
  const shift7 = { workingDays: 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday' };

  it('without one, the shift and branch apply as before', () => {
    const o = personalDaysOff({ shift: shift7, branch: { weeklyOffs: '0' } });
    expect(o.shiftWorkingDays).toBe(shift7.workingDays);
  });

  it('Sunday off for someone on a 7-day shift when their weekly off says so', () => {
    const o = personalDaysOff({ weeklyOffs: '0,6:even', shift: shift7, branch: null });
    expect(isRestDay(sunday, null, o.shiftWorkingDays, o.weeklyOffs)).toBe(true);
    expect(isRestDay(monday, null, o.shiftWorkingDays, o.weeklyOffs)).toBe(false);
  });

  it('Monday off, Sunday worked', () => {
    const o = personalDaysOff({ weeklyOffs: '1', shift: shift7, branch: { weeklyOffs: '0' } });
    expect(isRestDay(monday, null, o.shiftWorkingDays, o.weeklyOffs)).toBe(true);
    expect(isRestDay(sunday, null, o.shiftWorkingDays, o.weeklyOffs)).toBe(false);
  });

  it('NONE means every day is worked', () => {
    expect(isBranchWeeklyOff(sunday, 'NONE')).toBe(false);
  });

  it('a rostered day still wins', () => {
    const o = personalDaysOff({ weeklyOffs: '0', shift: shift7, branch: null });
    expect(isRestDay(sunday, { isDayOff: false, onsiteApprovalStatus: 'NONE' } as any, o.shiftWorkingDays, o.weeklyOffs)).toBe(false);
  });
});
