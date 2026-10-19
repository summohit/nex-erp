/**
 * Where a late clock-out stands, and what that means for the day (§Att5).
 *
 * A plain module rather than a service, for the same reason project-roles is
 * one: the attendance service writes this state, the payroll service reads it,
 * and the two must not disagree about whether a day was worked. A day that
 * counts on the attendance screen and not in payroll is worse than either
 * answer on its own.
 */

/**
 * Only ever set on a day closed out of a PREVIOUS day's session. Ordinary days
 * carry null: a session closed on the day it opened needs nobody's permission,
 * and giving those days a state would put the entire company in a queue.
 */
export const CLOCK_OUT_APPROVAL = {
  /** Claimed by the employee, not yet ruled on. Does not count as attended. */
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type ClockOutApproval =
  typeof CLOCK_OUT_APPROVAL[keyof typeof CLOCK_OUT_APPROVAL];

/**
 * Whether a day's attendance may be treated as worked.
 *
 * The company chose to block rather than merely flag: a forgotten clock-out is
 * the employee's own account of a day that has already ended, and until
 * somebody has agreed with it, it is a claim. Null — every ordinary day — is
 * attended, so this changes nothing for the overwhelming majority of rows.
 *
 * REJECTED is not attended either, and deliberately keeps its clock times: the
 * record of what was claimed and refused is the point, and blanking it would
 * leave a rejection indistinguishable from a day nobody ever opened.
 */
export function countsAsAttended(
  record: { clockOutApproval?: string | null } | null | undefined,
): boolean {
  if (!record) return false;
  const state = record.clockOutApproval;
  return state !== CLOCK_OUT_APPROVAL.PENDING && state !== CLOCK_OUT_APPROVAL.REJECTED;
}

/** Still waiting on somebody. */
export function isAwaitingClockOutApproval(
  record: { clockOutApproval?: string | null } | null | undefined,
): boolean {
  return record?.clockOutApproval === CLOCK_OUT_APPROVAL.PENDING;
}

type ClockOutDay = {
  status?: string | null; clockOutApproval?: string | null; missedClockOut?: boolean | null;
  autoClockedOut?: boolean | null; clockOutReason?: string | null;
  clockIn?: Date | string | null; clockOut?: Date | string | null;
};

/**
 * A day whose clock-out is not settled (19 Oct 2026, HR's rule): missed and
 * still open, closed automatically by the sweep, closed late with a reason
 * (including days from before approvals existed), waiting for approval, or
 * rejected. Only an approval settles it.
 */
export function clockOutUnsettled(record: ClockOutDay | null | undefined): boolean {
  if (!record?.clockIn) return false;
  const state = record.clockOutApproval;
  if (state === CLOCK_OUT_APPROVAL.APPROVED) return false;
  if (state === CLOCK_OUT_APPROVAL.PENDING || state === CLOCK_OUT_APPROVAL.REJECTED) return true;
  return (!!record.missedClockOut && !record.clockOut) || !!record.autoClockedOut || !!record.clockOutReason;
}

/**
 * The status payroll and the attendance screens use for a day: an unsettled
 * clock-out counts as a HALF DAY; once approved the day counts as recorded.
 * Days that were not worked keep their own status.
 */
export function payableDayStatus(record: ClockOutDay | null | undefined): string | null {
  if (!record) return null;
  return clockOutUnsettled(record) ? 'HALF_DAY' : record.status ?? null;
}

/** Why a day reads as a half day because of its clock-out, or null. */
export function clockOutHalfDayReason(record: ClockOutDay | null | undefined): string | null {
  if (!clockOutUnsettled(record)) return null;
  if (record!.clockOutApproval === CLOCK_OUT_APPROVAL.PENDING) return 'Clock-out waiting for approval';
  if (record!.clockOutApproval === CLOCK_OUT_APPROVAL.REJECTED) return 'Clock-out rejected';
  if (record!.autoClockedOut) return 'Never clocked out (closed automatically)';
  if (record!.clockOutReason) return 'Clocked out late, not approved yet';
  return 'Missed clock-out';
}
