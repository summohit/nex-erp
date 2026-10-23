/**
 * The rules of location-wise task tracking that need no database, kept apart
 * so they can be tested without one (docs/location-task-tracking.md).
 */

/**
 * Per-location execution tracking — each location's own status, people,
 * time and evidence, and the parent task moving with them.
 *
 * Off for now (decided 23 Oct 2026): a task simply names the locations it
 * covers, and moves across the board as any other task does. Turning this on
 * restores the location-driven status moves, the open-locations Done guard and
 * employees seeing only their own locations. The frontend has the same switch
 * in services/task-locations.service.ts; flip both together.
 */
export const LOCATION_TRACKING_ENABLED = false;

export const LOCATION_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  IN_REVIEW: 'IN_REVIEW',
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED',
} as const;

export const LOCATION_STATUSES: string[] = Object.values(LOCATION_STATUS);

export const LOCATION_LEVELS = ['STATE', 'CITY', 'SITE'];

export interface LocationProgress {
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  overdue: number;
  notStarted: number;
  percent: number;
}

/** Overdue: past its own due date and not completed. */
export function isLocationOverdue(
  loc: { status: string; dueDate?: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (!loc.dueDate || loc.status === LOCATION_STATUS.COMPLETED) return false;
  return new Date(loc.dueDate).getTime() < now.getTime();
}

/**
 * Progress over the locations still on the task. A removed location keeps its
 * records but no longer counts, in either direction.
 */
export function locationProgress(
  locations: { status: string; dueDate?: Date | string | null; removedAt?: Date | string | null }[],
  now: Date = new Date(),
): LocationProgress {
  const active = locations.filter((l) => !l.removedAt);
  const count = (s: string) => active.filter((l) => l.status === s).length;
  const completed = count(LOCATION_STATUS.COMPLETED);
  return {
    total: active.length,
    completed,
    inProgress: count(LOCATION_STATUS.IN_PROGRESS) + count(LOCATION_STATUS.IN_REVIEW),
    blocked: count(LOCATION_STATUS.BLOCKED),
    notStarted: count(LOCATION_STATUS.NOT_STARTED),
    overdue: active.filter((l) => isLocationOverdue(l, now)).length,
    percent: active.length ? Math.round((completed / active.length) * 100) : 0,
  };
}

/**
 * Whether removing this location would lose anything. A location nobody has
 * touched is deleted outright; one with time, evidence, activity beyond being
 * added, or a status other than Not Started is kept and soft-removed.
 */
export function locationHasHistory(loc: {
  status: string;
  timeLogCount: number;
  attachmentCount: number;
  /** Activity other than the ADDED entry every row starts with. */
  activityCount: number;
}): boolean {
  return loc.status !== LOCATION_STATUS.NOT_STARTED
    || loc.timeLogCount > 0
    || loc.attachmentCount > 0
    || loc.activityCount > 0;
}

/**
 * Where the parent task should move after its locations changed, or null to
 * leave it where it is.
 *
 * - every active location completed → IN_REVIEW, for the project manager to
 *   check and close (employees never move a task to Done themselves);
 * - parent in review or done but a location is open again → IN_PROGRESS;
 * - parent TODO and any location has started → IN_PROGRESS.
 *
 * A cancelled parent is never moved: cancelling is a decision about the whole
 * task, not something its locations can undo.
 */
export function parentStatusFor(
  parentStatus: string,
  locations: { status: string; removedAt?: Date | string | null }[],
): 'IN_REVIEW' | 'IN_PROGRESS' | null {
  if (parentStatus === 'CANCELLED') return null;
  const active = locations.filter((l) => !l.removedAt);
  if (!active.length) return null;

  const allDone = active.every((l) => l.status === LOCATION_STATUS.COMPLETED);
  if (allDone) return parentStatus === 'IN_REVIEW' || parentStatus === 'DONE' ? null : 'IN_REVIEW';
  if (parentStatus === 'IN_REVIEW' || parentStatus === 'DONE') return 'IN_PROGRESS';

  const started = active.some((l) => l.status !== LOCATION_STATUS.NOT_STARTED);
  if (parentStatus === 'TODO' && started) return 'IN_PROGRESS';
  return null;
}

/** The statuses an employee may set on their own location; managers have them all. */
export const EMPLOYEE_LOCATION_STATUSES: string[] = [
  LOCATION_STATUS.NOT_STARTED, LOCATION_STATUS.IN_PROGRESS, LOCATION_STATUS.COMPLETED,
];

/**
 * Whether a location is this employee's own: they are assigned to it, or
 * nobody is and they are on the task itself. Employees see and work only
 * their own locations; managers see every one.
 */
export function isOwnLocation(
  row: { assignees: { employeeId: number }[] },
  issue: { assigneeId?: number | null; members?: { employeeId: number }[] },
  employeeId: number | null | undefined,
): boolean {
  if (employeeId == null) return false;
  if (row.assignees.length) return row.assignees.some((a) => a.employeeId === employeeId);
  return issue.assigneeId === employeeId || !!issue.members?.some((m) => m.employeeId === employeeId);
}
