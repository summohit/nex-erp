/**
 * Whether a clock-in is late enough that the day starts as a half day.
 *
 * Split out of the clock-in path so the rule can be tested and, more to the
 * point, so the guard below lives somewhere it can be read.
 *
 * A shift's `halfDayTime` is the moment after which too little of the shift is
 * left to work a full day. It is only meaningful AFTER the shift has started.
 * Configured at or before `startTime` it does not express a policy at all — it
 * marks every single person half-day, including somebody who arrived exactly on
 * time, because any real clock-in is after the shift's own start.
 *
 * That is not hypothetical. "General Shift" ran with startTime and halfDayTime
 * both set to 09:30, and docked half a day's pay from people who were seconds
 * late: a HALF_DAY counts 0.5 against attendance in payroll, so the cost was
 * real money rather than a wrong-looking badge. Nothing rejected the setting,
 * and nothing about the screen made it obvious — the day just read "half day"
 * next to an on-time clock-in and an isLate of false, which is exactly the
 * combination nobody can explain.
 *
 * So a half-day boundary at or before the start is treated as absent. Ignoring
 * it is the safe direction: the day reads PRESENT and lateness is still caught
 * by the separate `isLate` check, whereas honouring it halves everybody's day.
 */
export function isHalfDayStart(
  now: Date,
  startTime: string | null | undefined,
  halfDayTime: string | null | undefined,
  resolve: (reference: Date, hhmm: string) => Date,
): boolean {
  if (!halfDayTime) return false;

  if (startTime) {
    const start = resolve(now, startTime);
    const boundary = resolve(now, halfDayTime);
    // Meaningless configuration — see above. Not an error to throw: a shift
    // edited badly must not stop people clocking in.
    if (boundary <= start) return false;
    return now > boundary;
  }

  // Duration-only shift: no start to compare against, so the boundary is taken
  // at face value.
  return now > resolve(now, halfDayTime);
}
