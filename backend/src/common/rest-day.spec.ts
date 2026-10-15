import { isRestDay } from './rest-day';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ALL_WEEK = 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday';
const BRANCH = '0:all,6:even';

describe('isRestDay', () => {
  it('follows the roster: a rostered Sunday is work, a rostered Monday is rest', () => {
    expect(isRestDay(day('2026-10-11'), { isDayOff: false }, ALL_WEEK, BRANCH)).toBe(false);
    expect(isRestDay(day('2026-10-12'), { isDayOff: true }, ALL_WEEK, BRANCH)).toBe(true);
  });

  it('ignores an all-week shift and falls back to the branch when there is no roster row', () => {
    expect(isRestDay(day('2026-10-11'), null, ALL_WEEK, BRANCH)).toBe(true); // Sunday
    expect(isRestDay(day('2026-10-10'), null, ALL_WEEK, BRANCH)).toBe(true); // 2nd Saturday
    expect(isRestDay(day('2026-10-03'), null, ALL_WEEK, BRANCH)).toBe(false); // 1st Saturday
  });

  it('uses a shift that really leaves days out', () => {
    expect(isRestDay(day('2026-10-11'), null, 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday', '')).toBe(true);
    expect(isRestDay(day('2026-10-10'), null, 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday', BRANCH)).toBe(false);
  });

  it('does not let a pending on-site request decide', () => {
    expect(isRestDay(day('2026-10-11'), { isDayOff: false, onsiteApprovalStatus: 'PENDING' }, ALL_WEEK, BRANCH)).toBe(true);
  });

  it('treats Sunday as rest when nothing is configured', () => {
    expect(isRestDay(day('2026-10-11'), null, null, null)).toBe(true);
    expect(isRestDay(day('2026-10-12'), null, null, null)).toBe(false);
  });
});
