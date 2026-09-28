import { isWeeklyOff, parseWeeklyOffs } from './weekly-offs';

/**
 * September 2026, the month the "23/20" total came from.
 * Saturdays: 5, 12, 19, 26. Sundays: 6, 13, 20, 27.
 */
const sept = (day: number) => new Date(2026, 8, day);

describe('the company’s actual rule', () => {
  // Every branch in the database carries "0": Sunday only. Saturday is a
  // working day, which the grid used to deny.
  const SUNDAY_ONLY = '0';

  it('treats Sunday as off', () => {
    expect(isWeeklyOff(sept(6), SUNDAY_ONLY)).toBe(true);
    expect(isWeeklyOff(sept(27), SUNDAY_ONLY)).toBe(true);
  });

  it('treats Saturday as a working day, which is the whole bug', () => {
    expect(isWeeklyOff(sept(5), SUNDAY_ONLY)).toBe(false);
    expect(isWeeklyOff(sept(12), SUNDAY_ONLY)).toBe(false);
    expect(isWeeklyOff(sept(19), SUNDAY_ONLY)).toBe(false);
    expect(isWeeklyOff(sept(26), SUNDAY_ONLY)).toBe(false);
  });

  it('treats an ordinary weekday as a working day', () => {
    expect(isWeeklyOff(sept(28), SUNDAY_ONLY)).toBe(false);
  });
});

describe('a two-day weekend', () => {
  it('is off on both, when the branch says so', () => {
    expect(isWeeklyOff(sept(5), '0,6')).toBe(true);
    expect(isWeeklyOff(sept(6), '0,6')).toBe(true);
    expect(isWeeklyOff(sept(28), '0,6')).toBe(false);
  });
});

describe('alternate Saturdays', () => {
  // "6:even" — the 2nd and 4th Saturday of the month.
  it('is off on the even occurrences only', () => {
    expect(isWeeklyOff(sept(5), '0,6:even')).toBe(false);   // 1st Saturday
    expect(isWeeklyOff(sept(12), '0,6:even')).toBe(true);   // 2nd
    expect(isWeeklyOff(sept(19), '0,6:even')).toBe(false);  // 3rd
    expect(isWeeklyOff(sept(26), '0,6:even')).toBe(true);   // 4th
  });

  it('is off on the odd occurrences for "odd"', () => {
    expect(isWeeklyOff(sept(5), '6:odd')).toBe(true);
    expect(isWeeklyOff(sept(12), '6:odd')).toBe(false);
  });
});

describe('a missing rule', () => {
  // Must match the server, which defaults to Sunday. Defaulting to "no days
  // off" would mark every Sunday absent for anybody without a branch.
  it('falls back to Sunday, as the server does', () => {
    expect(parseWeeklyOffs(null)).toEqual(['0']);
    expect(parseWeeklyOffs('')).toEqual(['0']);
    expect(isWeeklyOff(sept(6), null)).toBe(true);
    expect(isWeeklyOff(sept(5), undefined)).toBe(false);
  });

  it('ignores a malformed entry rather than throwing', () => {
    expect(isWeeklyOff(sept(6), 'nonsense,0')).toBe(true);
    expect(isWeeklyOff(sept(5), 'nonsense')).toBe(false);
  });
});
