/**
 * One row in "My Tasks", whatever it actually is underneath.
 *
 * Project work and pre-sales work are two different models with two different
 * vocabularies — one has a priority and a board column, the other has a
 * scheduled instant and an hours budget. Normalising them here rather than in
 * the template means the frontend renders one table instead of branching on
 * source in every cell.
 */
export type TaskSource = 'PROJECT' | 'GENERAL' | 'PRE_SALES';

/** The normalised status ladder. `rawStatus` keeps the source's own word. */
export type NormalisedStatus =
  | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'BLOCKED' | 'DONE' | 'CANCELLED';

export interface TaskPerson {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

export interface MyTaskDto {
  source: TaskSource;
  /** The id in its own table — meaningless without `source`. */
  id: number;
  /** "NEX-12" for an issue, "PS-45" synthesised for a pre-sales task. */
  refKey: string;
  title: string;
  status: NormalisedStatus;
  /** The source's own status word, so the badge reads "On Hold", not "Blocked". */
  rawStatus: string;
  /** Null for pre-sales, which has no priority — not defaulted to MEDIUM,
   *  because inventing a priority is worse than admitting there isn't one. */
  priority: string | null;
  taskType: string | null;
  /** Project key, e.g. CES/0925/07. Null on a general or deal task. */
  projectCode?: string | null;
  /** The milestone this task delivers, when it has one (§15). */
  milestone?: { id: number; name: string } | null;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
  assignees: TaskPerson[];
  parent: { kind: 'PROJECT' | 'GENERAL' | 'LEAD'; id: number; name: string } | null;
  /** Open blockers only. Informational — nothing is prevented by this. */
  blockedBy: { id: number; refKey: string; title: string }[];
  isOverdue: boolean;
  /**
   * Where clicking this row should go, decided server-side so the frontend
   * does not re-derive routing rules per source.
   */
  link: { route: string; queryParams: Record<string, string> };
  /**
   * Pre-sales only. A pre-sales task is now created and driven from My Tasks
   * rather than from the deal page, so the row carries everything those
   * actions need — the lead it hangs off, the raw schedule and duration the
   * edit form reopens with, and what this caller is allowed to do.
   *
   * The flags are for rendering buttons. Every one of them is re-checked by
   * CrmService before it writes.
   */
  preSales?: {
    leadId: number;
    assignedToId: number | null;
    assignedById: number | null;
    description: string | null;
    scheduledAt: Date | null;
    estimatedMinutes: number | null;
    canChangeStatus: boolean;
    canManage: boolean;
  };
}
