/**
 * Where a field visit request can be in its life (§3).
 *
 * Its own file because the attendance module has to ask the same question —
 * is this person on an approved trip today — and a second copy of these
 * strings is how the two drift apart.
 */
export const FIELD_VISIT_STATUS = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;

/** One person, one day of a trip. */
export const FIELD_VISIT_DAY = {
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  /**
   * Approved leave covers this day (§9).
   *
   * The row stays rather than being deleted, so the register can say "on
   * leave" instead of simply missing a day nobody can account for — which is
   * what §11 asks the Delivery view to show.
   */
  ON_LEAVE: 'ON_LEAVE',
} as const;

/** Days that still expect somebody to turn up. */
export const OPEN_VISIT_DAYS: string[] = [
  FIELD_VISIT_DAY.SCHEDULED,
  FIELD_VISIT_DAY.IN_PROGRESS,
];
