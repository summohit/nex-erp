/**
 * Who may see what a project costs.
 *
 * Rule 1 of the Delivery module: a normal employee must never see a project's
 * budget, the cost of the people on it, or the margin. They can see the work —
 * hours, tasks, milestones, their own time — and nothing commercial.
 *
 * This lives server-side and strips the fields from the payload rather than
 * hiding columns in the UI, because a hidden column is still in the response:
 * anyone can open the network tab, and the mobile client renders the same JSON
 * without the web app's guards.
 */

/** Company-wide roles that see money on every project. */
const FINANCIAL_ROLES = ['SUPERADMIN', 'ADMIN', 'FINANCE'];

/**
 * Fields stripped from a project for anyone who fails the check. Kept as one
 * list so a new commercial field is removed in every endpoint at once — the
 * failure mode of per-endpoint `select` clauses is that the newest field is the
 * one nobody remembered to exclude.
 */
export const PROJECT_FINANCIAL_FIELDS = [
  'budgetAmount',
  'budgetNotes',
  'hourlyRate',
  'billingType',
  'currency',
  'budgetUsed',
  'budgetRemaining',
  'budgetUtilization',
  'employeeCost',
  // Hours, but only meaningful as a caveat on employeeCost — on its own it is
  // a number with nothing to qualify. It goes with the cost it belongs to.
  'unratedHours',
  'expenseTotal',
  'paidExpenseTotal',
  'actualCost',
  'invoicedAmount',
  'paidAmount',
  'pendingAmount',
  'margin',
  // Milestone money. A milestone's name, dates and status are delivery facts
  // every member should see; its amount is the contract.
  'milestoneValue',
  'milestoneInvoicedValue',
] as const;

export interface FinancialViewer {
  role: string;
  /** Employee id of the person asking, when they have one. */
  employeeId: number | null;
}

/**
 * True when this person may see money on this project.
 *
 * Project managers and the project lead qualify for their own projects only:
 * running a project means owning its budget, but it says nothing about anyone
 * else's. `memberships` is the caller's ProjectMember rows for the project.
 */
export function canViewProjectFinancials(
  viewer: FinancialViewer,
  project: { leadId?: number | null; members?: { employeeId: number; role: string }[] } | null,
): boolean {
  if (FINANCIAL_ROLES.includes(viewer.role)) return true;
  if (!project || viewer.employeeId == null) return false;
  if (project.leadId === viewer.employeeId) return true;
  return (project.members || []).some(
    (m) => m.employeeId === viewer.employeeId && m.role === 'PROJECT_MANAGER',
  );
}

/**
 * Return the project with commercial fields removed unless the viewer may see
 * them, and a `canViewFinancials` flag so the client knows whether a missing
 * budget means "not set" or "not yours to see" — without that flag the UI has
 * to guess, and guessing produces a ₹0 budget on screen.
 */
export function applyFinancialVisibility<T extends Record<string, any>>(
  project: T,
  viewer: FinancialViewer,
): T & { canViewFinancials: boolean } {
  const allowed = canViewProjectFinancials(viewer, project as any);
  if (allowed) return { ...project, canViewFinancials: true };

  const stripped: Record<string, any> = { ...project };
  for (const field of PROJECT_FINANCIAL_FIELDS) delete stripped[field];
  return { ...stripped, canViewFinancials: false } as T & { canViewFinancials: boolean };
}

export function applyFinancialVisibilityAll<T extends Record<string, any>>(
  projects: T[],
  viewer: FinancialViewer,
): (T & { canViewFinancials: boolean })[] {
  return projects.map((p) => applyFinancialVisibility(p, viewer));
}
