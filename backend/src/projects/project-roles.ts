/**
 * Who may see and change what inside one project.
 *
 * A plain module rather than a service, for the same reason task-permissions
 * is one: IssuesService, ProjectsService and TasksService all need the rule,
 * and the answer must be identical in all three. A board that hides a task the
 * reports tab then shows is not a permission, it is a decoration.
 */
import { isCompanyAdmin, isSuperAdmin, normaliseRole } from '../common/company-roles';


/** The roles a ProjectMember row can hold. */
export const PROJECT_ROLE = {
  /** Runs the delivery: adds, edits and moves work. */
  MANAGER: 'PROJECT_MANAGER',
  /**
   * Sees the whole board without running it.
   *
   * An architect needs the shape of the work — every task, not only their own —
   * but the plan is the manager's to change.
   */
  ARCHITECT: 'TECHNICAL_ARCHITECT',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
} as const;

export interface ProjectViewer {
  employeeId: number | null;
  /** The role on their user account. */
  companyRole: string;
  /** Their ProjectMember.role on this project, when they are on it. */
  projectRole: string | null;
  /** Project.leadId — the owner. */
  isOwner: boolean;
}

/** Read the viewer's standing on one project. */
export async function resolveProjectViewer(
  prisma: {
    project: { findFirst: Function };
    projectMember: { findFirst: Function };
  },
  companyId: number,
  projectId: number,
  employeeId: number | null | undefined,
  companyRole: string | undefined,
): Promise<ProjectViewer> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId },
    select: { leadId: true },
  });

  const membership = employeeId
    ? await prisma.projectMember.findFirst({
        where: { projectId, employeeId },
        select: { role: true },
      })
    : null;

  return {
    employeeId: employeeId ?? null,
    companyRole: companyRole ?? 'EMPLOYEE',
    projectRole: membership?.role ?? null,
    isOwner: !!employeeId && project?.leadId === employeeId,
  };
}

/**
 * Whether they see the whole project's work, or only the part that is theirs.
 *
 * Owner, project manager, technical architect and company administrators see
 * everything. Everyone else — including a member holding the project's own
 * ADMIN role — sees the tasks they are actually on.
 */
export function seesEveryTask(viewer: ProjectViewer): boolean {
  if (isCompanyAdmin(viewer.companyRole)) return true;
  if (viewer.isOwner) return true;
  return viewer.projectRole === PROJECT_ROLE.MANAGER
    || viewer.projectRole === PROJECT_ROLE.ARCHITECT;
}

/**
 * Whether they may edit or move a task anywhere on the board.
 *
 * The architect is deliberately absent: seeing the whole plan is not the same
 * as being able to rewrite it. They can still comment and log time, which is
 * handled where those actions are, not here.
 */
export function mayChangeAnyTask(viewer: ProjectViewer): boolean {
  if (isCompanyAdmin(viewer.companyRole)) return true;
  if (viewer.isOwner) return true;
  return viewer.projectRole === PROJECT_ROLE.MANAGER;
}

/**
 * The `where` fragment that limits a task query to what the viewer may see,
 * or null when they may see everything.
 *
 * Assignee, member or reporter: a task somebody was added to, or raised and
 * handed over, is still theirs to look at. Combine it with `AND` rather than
 * spreading it, since several of these queries carry an `OR` of their own.
 */
export function taskVisibilityFilter(viewer: ProjectViewer): any | null {
  if (seesEveryTask(viewer)) return null;

  // -1 matches nobody. A login with no employee record sees nothing rather
  // than everything, which is the safe direction to fail in.
  const me = viewer.employeeId ?? -1;
  return {
    OR: [
      { assigneeId: me },
      { reporterId: me },
      { members: { some: { employeeId: me } } },
    ],
  };
}

/**
 * Whether they may see what the project costs (§PB5).
 *
 * The summary, milestones, budget requests and reports tabs all read the same
 * money: agreed budget, spend to date, and what each person's logged hours are
 * worth. Finance and the super admin see it because it is their job; the
 * project's own manager and its owner because they are answerable for it.
 *
 * Deliberately narrower than `seesEveryTask`: a company ADMIN or a technical
 * architect sees all the work without seeing what it is billed at. Kept in
 * step with `canSeeSummary` / `canSeeFinancialTabs` on the client — the client
 * hides the tab, this decides the answer, and hiding a tab whose endpoint
 * still answers is not a permission.
 */
export function seesProjectFinancials(viewer: ProjectViewer): boolean {
  if (isSuperAdmin(viewer.companyRole)) return true;
  if (normaliseRole(viewer.companyRole) === 'FINANCE') return true;
  if (viewer.isOwner) return true;
  return viewer.projectRole === PROJECT_ROLE.MANAGER;
}
