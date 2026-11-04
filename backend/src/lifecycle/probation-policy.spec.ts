import { normalisePolicy, probationEndFrom, probationMonthsFor, proRataDays } from './probation-policy';

describe('probation policy', () => {
  it('ends the day before the same date N months on', () => {
    expect(probationEndFrom(new Date('2026-03-23T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe('2026-09-22');
  });
  it('uses the category length, else the default', () => {
    const p = normalisePolicy({ monthsByCategory: { TRAINEE: 12 } });
    expect(probationMonthsFor(p, 'TRAINEE')).toBe(12);
    expect(probationMonthsFor(p, 'CONTRACT')).toBe(0);
    expect(probationMonthsFor(p, 'SOMETHING')).toBe(6);
  });
  it('credits the rest of the year, rounded down to the half day', () => {
    const sep22 = new Date('2026-09-22T00:00:00Z');
    expect(proRataDays(8, sep22)).toBe(2);   // 2.22
    expect(proRataDays(7, sep22)).toBe(1.5); // 1.94
    const jul1 = new Date('2026-07-01T00:00:00Z');
    expect(proRataDays(8, jul1)).toBe(4);    // 4.03
    expect(proRataDays(7, jul1)).toBe(3.5);  // 3.53
    expect(proRataDays(7, sep22, 'NEAREST')).toBe(2);
  });
});
