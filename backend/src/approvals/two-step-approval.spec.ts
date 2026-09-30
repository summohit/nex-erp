import {
  APPROVAL_STATE, decideApproval, isAwaitingApproval, isUsable, needsApprovalOnCreate,
} from './two-step-approval';
import { PROJECT_ROLE } from '../projects/project-roles';

const viewer = (over: any = {}) => ({
  employeeId: 60, companyRole: 'EMPLOYEE', projectRole: null, isOwner: false, ...over,
});

const ARCHITECT = viewer({ projectRole: PROJECT_ROLE.ARCHITECT });
const ADMIN = viewer({ companyRole: 'ADMIN' });
const SUPER = viewer({ companyRole: 'SUPERADMIN' });
const PM = viewer({ projectRole: PROJECT_ROLE.MANAGER });

describe('what is still in flight', () => {
  it('counts both pending steps', () => {
    expect(isAwaitingApproval(APPROVAL_STATE.PENDING_TECHNICAL)).toBe(true);
    expect(isAwaitingApproval(APPROVAL_STATE.PENDING_ADMIN)).toBe(true);
  });

  /**
   * The case that matters most. Every task raised before this feature carries
   * null, and treating those as unapproved would freeze the whole board.
   */
  it('leaves everything that predates approval alone', () => {
    expect(isAwaitingApproval(null)).toBe(false);
    expect(isAwaitingApproval(undefined)).toBe(false);
    expect(isUsable(null)).toBe(true);
  });

  it('treats a rejected item as unusable but settled', () => {
    expect(isAwaitingApproval(APPROVAL_STATE.REJECTED)).toBe(false);
    expect(isUsable(APPROVAL_STATE.REJECTED)).toBe(false);
  });

  it('treats an approved item as usable', () => {
    expect(isUsable(APPROVAL_STATE.APPROVED)).toBe(true);
  });
});

describe('the technical step', () => {
  it('lets the project’s architect pass it on to an administrator', () => {
    const d = decideApproval(APPROVAL_STATE.PENDING_TECHNICAL, ARCHITECT);
    expect(d).toEqual({ allowed: true, next: APPROVAL_STATE.PENDING_ADMIN, step: 'TECHNICAL' });
  });

  it('does not let the architect grant it outright', () => {
    // Their say is the technical read, not the commercial one.
    const d = decideApproval(APPROVAL_STATE.PENDING_TECHNICAL, ARCHITECT);
    expect(d.allowed && d.next).not.toBe(APPROVAL_STATE.APPROVED);
  });

  it('refuses a project manager, who raised it', () => {
    const d = decideApproval(APPROVAL_STATE.PENDING_TECHNICAL, PM);
    expect(d.allowed).toBe(false);
  });

  it('refuses the architect once it has moved past their step', () => {
    const d = decideApproval(APPROVAL_STATE.PENDING_ADMIN, ARCHITECT);
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.reason).toMatch(/administrator/i);
  });
});

describe('the administrator bypass', () => {
  it('settles it outright from the technical step', () => {
    const d = decideApproval(APPROVAL_STATE.PENDING_TECHNICAL, ADMIN);
    expect(d).toEqual({ allowed: true, next: APPROVAL_STATE.APPROVED, step: 'ADMIN' });
  });

  it('settles it from the admin step too', () => {
    const d = decideApproval(APPROVAL_STATE.PENDING_ADMIN, ADMIN);
    expect(d.allowed && d.next).toBe(APPROVAL_STATE.APPROVED);
  });

  it('works for a super admin as well', () => {
    expect(decideApproval(APPROVAL_STATE.PENDING_TECHNICAL, SUPER).allowed).toBe(true);
  });
});

describe('approving something that is not waiting', () => {
  it('is refused, whoever asks', () => {
    expect(decideApproval(APPROVAL_STATE.APPROVED, ADMIN).allowed).toBe(false);
    expect(decideApproval(APPROVAL_STATE.REJECTED, SUPER).allowed).toBe(false);
    expect(decideApproval(null, ADMIN).allowed).toBe(false);
  });
});

describe('whose new tasks need approving', () => {
  it('needs it for a project manager', () => {
    expect(needsApprovalOnCreate(PM)).toBe(true);
  });

  /**
   * The two people who would have been asked. Sending them a request to
   * approve themselves is a queue entry that decides nothing.
   */
  it('does not for an administrator', () => {
    expect(needsApprovalOnCreate(ADMIN)).toBe(false);
    expect(needsApprovalOnCreate(SUPER)).toBe(false);
  });

  it('does not for the technical architect', () => {
    expect(needsApprovalOnCreate(ARCHITECT)).toBe(false);
  });

  it('does not for anybody else who may raise a task', () => {
    expect(needsApprovalOnCreate(viewer({ projectRole: PROJECT_ROLE.MEMBER }))).toBe(false);
    expect(needsApprovalOnCreate(viewer())).toBe(false);
  });

  it('exempts an administrator who also manages the project', () => {
    // Otherwise they would raise a request only they could settle.
    const both = viewer({ companyRole: 'ADMIN', projectRole: PROJECT_ROLE.MANAGER });
    expect(needsApprovalOnCreate(both)).toBe(false);
  });
});

/**
 * §PB8, revised: rejection sends a task back to be improved rather than
 * archiving it. The state machine below is what makes a resubmit possible.
 */
describe('a rejected task', () => {
  it('is not waiting on anybody', () => {
    // It is the manager's move, not an approver's — so it must not sit in
    // anyone's queue while they wait for changes.
    expect(isAwaitingApproval(APPROVAL_STATE.REJECTED)).toBe(false);
  });

  it('cannot be approved without being resubmitted first', () => {
    expect(decideApproval(APPROVAL_STATE.REJECTED, ADMIN).allowed).toBe(false);
    expect(decideApproval(APPROVAL_STATE.REJECTED, ARCHITECT).allowed).toBe(false);
  });

  /**
   * Resubmitting restarts at the technical step rather than resuming where it
   * was refused. The thing being approved has changed, so an earlier technical
   * sign-off no longer describes it.
   */
  it('goes back through the technical step once resubmitted', () => {
    const d = decideApproval(APPROVAL_STATE.PENDING_TECHNICAL, ARCHITECT);
    expect(d).toEqual({ allowed: true, next: APPROVAL_STATE.PENDING_ADMIN, step: 'TECHNICAL' });
  });
});
