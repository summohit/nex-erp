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
} as const;
