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
