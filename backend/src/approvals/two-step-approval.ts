/**
 * Approval that takes two people, and the one shortcut through it.
 *
 * A task a project manager raises, and a budget increase they ask for, both go
 * the same way: the project's technical architect looks at it first, then an
 * administrator signs it off. An administrator can approve at any point, which
 * settles the technical step too — that is the bypass, and it is deliberate:
 * the second signature exists to catch things, not to make the person who can
 * overrule everybody wait for somebody who cannot.
 *
 * A plain module rather than a service, for the same reason project-roles is
 * one: issues, budget requests and whatever asks next all need the identical
 * answer, and two implementations would be two rules.
 */
import { isCompanyAdmin } from '../common/company-roles';
import { PROJECT_ROLE, ProjectViewer } from '../projects/project-roles';

export const APPROVAL_STATE = {
  /** Raised, waiting on the project's technical architect. */
  PENDING_TECHNICAL: 'PENDING_TECHNICAL',
  /** Technical is satisfied; waiting on an administrator. */
  PENDING_ADMIN: 'PENDING_ADMIN',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type ApprovalState = typeof APPROVAL_STATE[keyof typeof APPROVAL_STATE];

/** Still going through approval, so not yet a thing anybody may act on. */
export function isAwaitingApproval(state?: string | null): boolean {
  return state === APPROVAL_STATE.PENDING_TECHNICAL
    || state === APPROVAL_STATE.PENDING_ADMIN;
}

/**
 * Settled and usable.
 *
 * Null counts as settled, and has to: every task that existed before this
 * feature carries null, and treating those as unapproved would freeze the
 * entire board.
 */
export function isUsable(state?: string | null): boolean {
  return !isAwaitingApproval(state) && state !== APPROVAL_STATE.REJECTED;
}

export type ApprovalDecision =
  | { allowed: true; next: ApprovalState; step: 'TECHNICAL' | 'ADMIN' }
  | { allowed: false; reason: string };

/**
 * What this person's approval would do to something in this state.
 *
 * Returns the next state rather than a boolean, because "may they approve" and
 * "what does approving mean here" are the same question: an administrator
 * approving something still waiting on technical jumps it straight to
 * APPROVED, and the caller needs to know that to record it.
 */
export function decideApproval(
  state: string | null | undefined,
  viewer: ProjectViewer,
): ApprovalDecision {
  if (!isAwaitingApproval(state)) {
    return { allowed: false, reason: 'This is not waiting for approval.' };
  }

  // The bypass. An administrator settles it outright, from either step.
  if (isCompanyAdmin(viewer.companyRole)) {
    return { allowed: true, next: APPROVAL_STATE.APPROVED, step: 'ADMIN' };
  }

  if (state === APPROVAL_STATE.PENDING_TECHNICAL) {
    if (viewer.projectRole === PROJECT_ROLE.ARCHITECT) {
      // Passes it on rather than granting it: the architect's job is the
      // technical read, not the commercial one.
      return { allowed: true, next: APPROVAL_STATE.PENDING_ADMIN, step: 'TECHNICAL' };
    }
    return {
      allowed: false,
      reason: 'This is waiting for the project’s technical architect.',
    };
  }

  // PENDING_ADMIN, and they are not an administrator. The architect has had
  // their say and cannot also give the final sign-off.
  return { allowed: false, reason: 'This is waiting for an administrator.' };
}

/** Who may refuse it outright: the same people who could have approved it. */
export function mayReject(state: string | null | undefined, viewer: ProjectViewer): boolean {
  return decideApproval(state, viewer).allowed;
}

/**
 * Whether a task this person is creating has to be approved before it counts
 * (§PB8).
 *
 * Only a project manager's own tasks. An administrator or the project's
 * technical architect creating one skips approval entirely — they are the two
 * people who would have been asked, and sending them a request to approve
 * themselves is a queue entry that decides nothing.
 *
 * Checked in that order deliberately: somebody who is both an administrator
 * and the project's manager does not get their own approval queue.
 */
export function needsApprovalOnCreate(viewer: ProjectViewer): boolean {
  if (isCompanyAdmin(viewer.companyRole)) return false;
  if (viewer.projectRole === PROJECT_ROLE.ARCHITECT) return false;
  return viewer.projectRole === PROJECT_ROLE.MANAGER;
}
