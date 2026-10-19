import {
  CLOCK_OUT_APPROVAL, countsAsAttended, isAwaitingClockOutApproval,
} from './clock-out-approval';

/**
 * §Att5. The company chose to block rather than flag: a day closed out of a
 * previous session is the employee's own account of a day that has already
 * ended, and until somebody agrees with it, it is a claim.
 *
 * The case that matters most is the first one. Ordinary days — every day
 * closed on the day it opened — carry null, and if null ever stopped counting
 * as attended this feature would mark the entire company absent.
 */
describe('whether a day counts as attended', () => {
  it('counts an ordinary day, which has no approval state at all', () => {
    expect(countsAsAttended({ clockOutApproval: null })).toBe(true);
    expect(countsAsAttended({})).toBe(true);
  });

  it('counts a late clock-out once it has been approved', () => {
    expect(countsAsAttended({ clockOutApproval: CLOCK_OUT_APPROVAL.APPROVED })).toBe(true);
  });

  it('does not count one that is still waiting', () => {
    expect(countsAsAttended({ clockOutApproval: CLOCK_OUT_APPROVAL.PENDING })).toBe(false);
  });

  it('does not count one that was refused', () => {
    expect(countsAsAttended({ clockOutApproval: CLOCK_OUT_APPROVAL.REJECTED })).toBe(false);
  });

  it('does not count a day that is not there', () => {
    expect(countsAsAttended(null)).toBe(false);
    expect(countsAsAttended(undefined)).toBe(false);
  });
});

describe('what is still in the queue', () => {
  it('is only the pending ones', () => {
    expect(isAwaitingClockOutApproval({ clockOutApproval: CLOCK_OUT_APPROVAL.PENDING })).toBe(true);
    expect(isAwaitingClockOutApproval({ clockOutApproval: CLOCK_OUT_APPROVAL.APPROVED })).toBe(false);
    expect(isAwaitingClockOutApproval({ clockOutApproval: null })).toBe(false);
    expect(isAwaitingClockOutApproval(null)).toBe(false);
  });
});

describe('payableDayStatus (19 Oct 2026: unsettled clock-out = half day)', () => {
  const { payableDayStatus } = require('./clock-out-approval');
  const worked = { status: 'PRESENT', clockIn: new Date(), clockOut: new Date() };
  it('keeps an ordinary day as recorded', () => {
    expect(payableDayStatus({ ...worked, clockOutApproval: null })).toBe('PRESENT');
  });
  it('makes a pending or rejected clock-out a half day', () => {
    expect(payableDayStatus({ ...worked, clockOutApproval: 'PENDING' })).toBe('HALF_DAY');
    expect(payableDayStatus({ ...worked, clockOutApproval: 'REJECTED' })).toBe('HALF_DAY');
  });
  it('gives an approved clock-out its full day back', () => {
    expect(payableDayStatus({ ...worked, clockOutApproval: 'APPROVED' })).toBe('PRESENT');
  });
  it('makes a missed, still-open clock-out a half day', () => {
    expect(payableDayStatus({ status: 'PRESENT', clockIn: new Date(), clockOut: null, missedClockOut: true })).toBe('HALF_DAY');
  });
  it('leaves days nobody worked alone', () => {
    expect(payableDayStatus({ status: 'ABSENT', clockIn: null, clockOutApproval: 'PENDING' })).toBe('ABSENT');
  });
});
