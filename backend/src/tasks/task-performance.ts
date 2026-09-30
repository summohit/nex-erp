/**
 * Who is delivering tasks well (§Tasks1).
 *
 * A pure function over already-counted figures, so the rule can be read and
 * tested without a database. The shape mirrors the attendance champions: a
 * blend rather than a single number, because any single number rewards one
 * behaviour and quietly punishes the rest.
 */

/** What one person did in the window. */
export interface TaskPerformanceInput {
  employeeId: number;
  name: string;
  avatarUrl?: string | null;
  /** Tasks they finished in the window. */
  completed: number;
  /**
   * Of those, the ones that had a due date AND were finished on or before it.
   * Tasks with no due date are excluded from BOTH this and `withDueDate` —
   * you cannot be late for a deadline that never existed, and counting them
   * as on time would reward never setting one.
   */
  onTime: number;
  /** Completed tasks that had a due date at all. */
  withDueDate: number;
}

export interface TaskPerformer extends TaskPerformanceInput {
  /** Share of dated tasks delivered by their due date, 0–100. */
  onTimeRate: number;
  /** Their completed count against the best in the window, 0–100. */
  volumeScore: number;
  score: number;
}

/**
 * Below this, a "rate" is noise.
 *
 * One task finished on time is 100%, which would sit above somebody who
 * delivered thirty at 95%. That is how a leaderboard stops being believed.
 */
export const MIN_COMPLETED_TO_RANK = 5;

/** On-time delivery is most of it; throughput is the rest. */
const ON_TIME_WEIGHT = 0.6;
const VOLUME_WEIGHT = 0.4;

export function rankTaskPerformers(
  rows: TaskPerformanceInput[],
  limit = 3,
): TaskPerformer[] {
  const eligible = rows.filter((r) => r.completed >= MIN_COMPLETED_TO_RANK);
  if (!eligible.length) return [];

  // Volume is scored against the best in the window rather than raw, so one
  // person clearing a backlog does not flatten everybody else to nothing.
  const most = Math.max(...eligible.map((r) => r.completed));

  const scored = eligible.map((r) => {
    // No dated tasks at all: they delivered, but nothing here says whether it
    // was on time. Scored on volume alone rather than given a free 100%.
    const onTimeRate = r.withDueDate > 0
      ? Math.round((r.onTime / r.withDueDate) * 100)
      : 0;
    const volumeScore = most > 0 ? Math.round((r.completed / most) * 100) : 0;

    const score = r.withDueDate > 0
      ? onTimeRate * ON_TIME_WEIGHT + volumeScore * VOLUME_WEIGHT
      : volumeScore * VOLUME_WEIGHT;

    return { ...r, onTimeRate, volumeScore, score: Math.round(score * 10) / 10 };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Ties break towards reliability, then throughput, then a stable id so the
    // order does not shuffle between two identical reads.
    if (b.onTimeRate !== a.onTimeRate) return b.onTimeRate - a.onTimeRate;
    if (b.completed !== a.completed) return b.completed - a.completed;
    return a.employeeId - b.employeeId;
  });

  return scored.slice(0, limit);
}
