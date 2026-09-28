import { isHalfDayStart } from './half-day-rule';
import { istTimeInstant } from '../common/timezone.util';

/**
 * The half-day boundary, and the misconfiguration that made it bite.
 *
 * Times below are IST wall-clock on one ordinary day, resolved the same way
 * the clock-in path resolves them.
 */
const ist = (hhmm: string) => istTimeInstant(new Date('2026-09-28T00:00:00Z'), hhmm);

/** IST instant with seconds, for the cases that turn on them. */
const istSec = (hh: number, mm: number, ss: number) =>
  new Date(Date.UTC(2026, 8, 28, hh, mm, ss) - 5.5 * 3600 * 1000);

describe('a sanely configured half-day boundary', () => {
  // General Shift as it should be: 09:30 start, half day once more than a
  // minute late.
  const check = (now: Date) => isHalfDayStart(now, '09:30', '09:32', istTimeInstant);

  it('leaves an on-time arrival alone', () => {
    expect(check(ist('09:30'))).toBe(false);
  });

  it('leaves a arrival inside the minute of grace alone', () => {
    expect(check(istSec(9, 31, 59))).toBe(false);
  });

  it('halves the day once past the boundary', () => {
    expect(check(istSec(9, 32, 1))).toBe(true);
    expect(check(ist('14:00'))).toBe(true);
  });
});

/**
 * The bug this guard exists for. "General Shift" carried startTime 09:30 and
 * halfDayTime 09:30, which marked a 09:30:14 clock-in as a half day — and a
 * HALF_DAY costs 0.5 of a day in payroll.
 */
describe('a half-day boundary at or before the shift start', () => {
  it('is ignored rather than halving everybody', () => {
    const fourteenSecondsLate = istSec(9, 30, 14);
    expect(isHalfDayStart(fourteenSecondsLate, '09:30', '09:30', istTimeInstant)).toBe(false);
    // Even hours into the shift: the setting says nothing, so it decides nothing.
    expect(isHalfDayStart(ist('16:00'), '09:30', '09:30', istTimeInstant)).toBe(false);
  });

  it('is ignored when the boundary is before the start', () => {
    expect(isHalfDayStart(ist('11:00'), '09:30', '09:00', istTimeInstant)).toBe(false);
  });

  it('still honours a boundary that is genuinely after the start', () => {
    expect(isHalfDayStart(ist('15:00'), '09:30', '14:00', istTimeInstant)).toBe(true);
    expect(isHalfDayStart(ist('13:00'), '09:30', '14:00', istTimeInstant)).toBe(false);
  });
});

describe('shifts with nothing to compare', () => {
  it('never half-days when no boundary is set', () => {
    expect(isHalfDayStart(ist('17:00'), '09:00', null, istTimeInstant)).toBe(false);
    expect(isHalfDayStart(ist('17:00'), '09:00', undefined, istTimeInstant)).toBe(false);
  });

  it('takes the boundary at face value on a duration-only shift', () => {
    expect(isHalfDayStart(ist('15:00'), null, '14:00', istTimeInstant)).toBe(true);
    expect(isHalfDayStart(ist('13:00'), null, '14:00', istTimeInstant)).toBe(false);
  });
});
