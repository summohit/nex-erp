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
