/**
 * The ceiling on how much time may be logged against a task (§3).
 *
 * The rule the business asked for is "an employee may not log more than the
 * hours assigned to the task, unless extra hours have been approved". This
 * module is that rule and nothing else: no Prisma, no request context, so both
 * the timer and the manual timesheet grid can apply exactly the same arithmetic
 * and the tests can cover the edges without a database.
 */

export class HoursExceeded extends Error {
  constructor(
    message: string,
    readonly allowed: number,
    readonly logged: number,
    readonly requested: number,
  ) {
    super(message);
  }
}

export interface TaskHoursState {
  /** What the task was assigned, in hours. Null means "never estimated". */
  estimatedHours: number | null;
  /** Extra hours granted by approved requests. */
  additionalHours: number;
  /** Everything already logged against the task, in minutes. */
  loggedMinutes: number;
}

/**
 * The total hours allowed on the task, or null when it is unbounded.
 *
 * A task with no estimate is deliberately unbounded rather than blocked at
 * zero. `estimatedHours` is optional and always has been, so most tasks
 * already in the database have none -- treating that as a ceiling of zero
 * would stop every one of them from being worked on the moment this ships.
 * An unestimated task is not a task with no budget, it is a task nobody has
 * budgeted yet, and that is a planning gap, not a violation to enforce.
 */
export function allowedHours(state: TaskHoursState): number | null {
  if (state.estimatedHours == null) return null;
  return round2(state.estimatedHours + (state.additionalHours || 0));
}

/** Hours still available on the task, or null when unbounded. */
export function remainingHours(state: TaskHoursState): number | null {
  const allowed = allowedHours(state);
  if (allowed == null) return null;
  return round2(Math.max(0, allowed - minutesToHours(state.loggedMinutes)));
}

/**
 * Assert that `additionalMinutes` more may be logged against the task.
 *
 * @param excludeMinutes minutes already counted in `loggedMinutes` that this
 *   write is replacing -- the manual grid upserts one row per day, so editing
 *   a 2h entry to 3h must be checked as +1h, not +3h.
 * @throws HoursExceeded when the write would take the task past its ceiling.
 */
export function assertWithinAllowedHours(
  state: TaskHoursState,
  additionalMinutes: number,
  excludeMinutes = 0,
): void {
  const allowed = allowedHours(state);
  if (allowed == null) return;

  const alreadyLogged = minutesToHours(Math.max(0, state.loggedMinutes - excludeMinutes));
  const requested = minutesToHours(additionalMinutes);
  const total = round2(alreadyLogged + requested);

  // Compared with a cent-level tolerance: hours arrive as floats derived from
  // minute counts, and 7.999999999999999 <= 8 must not be a rejection.
  if (total <= allowed + 0.005) return;

  const left = round2(Math.max(0, allowed - alreadyLogged));
  throw new HoursExceeded(
    left > 0
      ? `Only ${fmt(left)}h of the ${fmt(allowed)}h assigned to this task are left. ` +
        `Request additional hours to log more.`
      : `All ${fmt(allowed)}h assigned to this task have been logged. ` +
        `Request additional hours to log more.`,
    allowed,
    round2(alreadyLogged),
    requested,
  );
}

function minutesToHours(minutes: number): number {
  return round2((minutes || 0) / 60);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Trims the trailing zeros so a message reads "4h", not "4.00h". */
function fmt(n: number): string {
  return String(round2(n));
}
