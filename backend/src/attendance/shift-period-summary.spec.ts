import { resolvePeriod, datesInRange } from './shift-period-summary';

/**
 * Period boundaries fail silently: an off-by-one moves somebody's Monday into
 * last week and the totals are simply wrong, with nothing to notice.
 */
describe('§Att7 period boundaries', () => {
  const d = (s: string) => new Date(`${s}T12:00:00`);
  const key = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

  describe('weeks run Monday to Sunday', () => {
    it('takes a midweek day back to its Monday', () => {
      const r = resolvePeriod('week', d('2026-09-30')); // a Wednesday
      expect(key(r.from)).toBe('2026-09-28');
      expect(key(r.to)).toBe('2026-10-04');
    });

    it('leaves a Monday where it is', () => {
      const r = resolvePeriod('week', d('2026-09-28'));
      expect(key(r.from)).toBe('2026-09-28');
    });

    /** The case a naive getDay() subtraction gets wrong: Sunday is 0. */
    it('puts Sunday at the END of its week, not the start', () => {
      const r = resolvePeriod('week', d('2026-10-04'));
      expect(key(r.from)).toBe('2026-09-28');
      expect(key(r.to)).toBe('2026-10-04');
    });

    it('spans a month boundary without clipping', () => {
      const r = resolvePeriod('week', d('2026-10-01')); // Thursday
      expect(key(r.from)).toBe('2026-09-28');
      expect(key(r.to)).toBe('2026-10-04');
      expect(datesInRange(r)).toHaveLength(7);
    });
  });

  describe('months', () => {
    it('covers the whole month inclusively', () => {
      const r = resolvePeriod('month', d('2026-09-15'));
      expect(key(r.from)).toBe('2026-09-01');
      expect(key(r.to)).toBe('2026-09-30');
      expect(datesInRange(r)).toHaveLength(30);
    });

    it('gets a 31-day month right', () => {
      const r = resolvePeriod('month', d('2026-10-20'));
      expect(key(r.to)).toBe('2026-10-31');
      expect(datesInRange(r)).toHaveLength(31);
    });

    /** Day 0 of the next month, so February needs no special case. */
    it('gets February right in a leap year', () => {
      expect(key(resolvePeriod('month', d('2028-02-10')).to)).toBe('2028-02-29');
    });

    it('gets February right in a non-leap year', () => {
      expect(key(resolvePeriod('month', d('2026-02-10')).to)).toBe('2026-02-28');
    });

    it('does not roll December into the next year', () => {
      const r = resolvePeriod('month', d('2026-12-10'));
      expect(key(r.from)).toBe('2026-12-01');
      expect(key(r.to)).toBe('2026-12-31');
    });
  });
});
