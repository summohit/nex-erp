import { isBranchWeeklyOff } from './weekly-offs';
import { ShiftRosterService } from '../attendance/shift-roster.service';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('branch weekly offs', () => {
  // October 2026 Saturdays: 3rd (1st), 10th (2nd), 17th (3rd), 24th (4th), 31st (5th).
  const RULE = '0,6:even';

  it('makes the 2nd and 4th Saturday off', () => {
    expect(isBranchWeeklyOff(day('2026-10-10'), RULE)).toBe(true);
    expect(isBranchWeeklyOff(day('2026-10-24'), RULE)).toBe(true);
  });

  it('keeps the 1st, 3rd and 5th Saturday working', () => {
    expect(isBranchWeeklyOff(day('2026-10-03'), RULE)).toBe(false);
    expect(isBranchWeeklyOff(day('2026-10-17'), RULE)).toBe(false);
    expect(isBranchWeeklyOff(day('2026-10-31'), RULE)).toBe(false);
  });

  it('keeps every Sunday off and weekdays working', () => {
    expect(isBranchWeeklyOff(day('2026-10-04'), RULE)).toBe(true);
    expect(isBranchWeeklyOff(day('2026-10-05'), RULE)).toBe(false);
  });

  it('treats an empty rule as Sunday only, like payroll', () => {
    expect(isBranchWeeklyOff(day('2026-10-04'), '')).toBe(true);
    expect(isBranchWeeklyOff(day('2026-10-10'), '')).toBe(false);
  });

  describe('roster resolution', () => {
    const standing = {
      id: 1, name: 'General Shift', startTime: '09:30', endTime: '18:30',
      bufferTimeMinutes: 15, workingDays: 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday',
    };

    it('makes a 2nd Saturday a day off for a Mon–Sat shift', () => {
      const r = ShiftRosterService.resolveEffectiveShift(null, standing, day('2026-10-10'), RULE);
      expect(r.isDayOff).toBe(true);
    });

    it('keeps a 3rd Saturday a working day', () => {
      const r = ShiftRosterService.resolveEffectiveShift(null, standing, day('2026-10-17'), RULE);
      expect(r.isDayOff).toBe(false);
    });

    it('ignores the branch rule when the employee has no branch', () => {
      const r = ShiftRosterService.resolveEffectiveShift(null, standing, day('2026-10-10'), null);
      expect(r.isDayOff).toBe(false);
    });
  });
});
