import {
  allowedHours, remainingHours, assertWithinAllowedHours, HoursExceeded, TaskHoursState,
} from './task-hours';

const state = (o: Partial<TaskHoursState> = {}): TaskHoursState => ({
  estimatedHours: 4, additionalHours: 0, loggedMinutes: 0, ...o,
});

describe('allowedHours', () => {
  it('is the estimate plus approved extra hours', () => {
    expect(allowedHours(state({ estimatedHours: 4, additionalHours: 2 }))).toBe(6);
  });

  it('is unbounded when the task was never estimated', () => {
    expect(allowedHours(state({ estimatedHours: null }))).toBeNull();
  });
});

describe('remainingHours', () => {
  it('is what is left of the ceiling', () => {
    expect(remainingHours(state({ estimatedHours: 4, loggedMinutes: 180 }))).toBe(1);
  });

  it('never goes negative, so the task list cannot show "-2h left"', () => {
    expect(remainingHours(state({ estimatedHours: 4, loggedMinutes: 360 }))).toBe(0);
  });

  it('counts approved extra hours', () => {
    expect(remainingHours(state({ estimatedHours: 4, additionalHours: 4, loggedMinutes: 300 }))).toBe(3);
  });
});

describe('assertWithinAllowedHours', () => {
  it('allows a log that fits', () => {
    expect(() => assertWithinAllowedHours(state({ loggedMinutes: 120 }), 60)).not.toThrow();
  });

  it('allows a log that lands exactly on the ceiling', () => {
    expect(() => assertWithinAllowedHours(state({ loggedMinutes: 180 }), 60)).not.toThrow();
  });

  it('rejects a log that would exceed the assigned hours', () => {
    expect(() => assertWithinAllowedHours(state({ loggedMinutes: 180 }), 120)).toThrow(HoursExceeded);
  });

  it('says how much is left, so the message is actionable', () => {
    try {
      assertWithinAllowedHours(state({ loggedMinutes: 180 }), 120);
      fail('expected a rejection');
    } catch (e) {
      expect((e as HoursExceeded).message).toContain('Only 1h of the 4h');
    }
  });

  it('reads differently once nothing is left at all', () => {
    try {
      assertWithinAllowedHours(state({ loggedMinutes: 240 }), 60);
      fail('expected a rejection');
    } catch (e) {
      expect((e as HoursExceeded).message).toContain('All 4h');
    }
  });

  it('lets approved extra hours unblock a task that was full', () => {
    const full = state({ loggedMinutes: 240 });
    expect(() => assertWithinAllowedHours(full, 60)).toThrow(HoursExceeded);
    expect(() => assertWithinAllowedHours({ ...full, additionalHours: 2 }, 60)).not.toThrow();
  });

  it('never blocks a task that was never estimated', () => {
    expect(() =>
      assertWithinAllowedHours(state({ estimatedHours: null, loggedMinutes: 6000 }), 600),
    ).not.toThrow();
  });

  // The manual grid upserts one row per employee/issue/day. Editing an entry
  // must be checked as the delta, or raising 2h to 3h on a 4h task with 2h
  // already logged would be read as 2h + 3h and refused.
  it('checks an edited entry as a delta, not as a fresh log', () => {
    const s = state({ estimatedHours: 4, loggedMinutes: 120 });
    expect(() => assertWithinAllowedHours(s, 180, 120)).not.toThrow();
  });

  it('still refuses an edit that overshoots', () => {
    const s = state({ estimatedHours: 4, loggedMinutes: 120 });
    expect(() => assertWithinAllowedHours(s, 300, 120)).toThrow(HoursExceeded);
  });

  it('tolerates float drift rather than rejecting on a rounding error', () => {
    // 20 minutes thrice is 0.9999… hours in floating point.
    const s = state({ estimatedHours: 1, loggedMinutes: 40 });
    expect(() => assertWithinAllowedHours(s, 20)).not.toThrow();
  });
});
