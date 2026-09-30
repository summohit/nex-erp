/**
 * The decisions a company can delegate.
 *
 * A string union rather than a Prisma enum: adding a workflow should be a code
 * change reviewed alongside the feature that needs it, not a migration on a
 * shared database.
 *
 * Each entry names a decision that has no natural owner in the data. Anything
 * with one — a task's extra hours belong to its project's managers, a leave
 * request to the employee's manager — keeps deciding for itself; delegation is
 * for the decisions that would otherwise all land on the company owner.
 */
export const APPROVAL_WORKFLOW = {
  /** §Att5: a late or forgotten clock-out, with its evidence. */
  CLOCK_OUT: 'CLOCK_OUT',
  /** §PB7: a purchase order, before it goes to finance. */
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  /** §PB8: a task, before or after it is created. */
  TASK: 'TASK',
  /** §Att9/§Att10: leave raised or cancelled on somebody else's behalf. */
  LEAVE_ON_BEHALF: 'LEAVE_ON_BEHALF',
  /** An employee's expense claim, approved and then paid outside payroll. */
  EXPENSE_CLAIM: 'EXPENSE_CLAIM',
} as const;

export type ApprovalWorkflow = typeof APPROVAL_WORKFLOW[keyof typeof APPROVAL_WORKFLOW];

export const APPROVAL_WORKFLOWS = Object.values(APPROVAL_WORKFLOW) as ApprovalWorkflow[];

/** What each queue is called on screen. */
export const APPROVAL_WORKFLOW_LABELS: Record<ApprovalWorkflow, string> = {
  CLOCK_OUT: 'Late & forgotten clock-outs',
  PURCHASE_ORDER: 'Purchase orders',
  TASK: 'Task approvals',
  LEAVE_ON_BEHALF: 'Leave raised on behalf of others',
  EXPENSE_CLAIM: 'Expense claims',
};

export function isApprovalWorkflow(value: unknown): value is ApprovalWorkflow {
  return typeof value === 'string' && (APPROVAL_WORKFLOWS as string[]).includes(value);
}
