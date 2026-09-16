import { IssuesService } from './issues.service';

/**
 * Who may move a task into Review, Done or Archived.
 *
 * This guard refused administrators, which nothing else in this codebase does:
 * canCreateTask lets them through, and updateIssue's content-edit check exempts
 * them by name. The gap only became obvious with the General project, which is
 * created by the system with no owner and no project managers — so for a task
 * living there the assignee's manager chain was the only route, and an
 * administrator who managed nobody could not close a general task at all.
 */
describe('IssuesService — moving a task to Done or Archived', () => {
  const COMPANY = 1;
  const ADMIN = 900;      // an administrator, in nobody's manager chain
  const ASSIGNEE = 5;
  const MANAGER = 6;      // the assignee's manager
  const BYSTANDER = 7;

  let prisma: any;
  let service: IssuesService;

  /** The General project: system-created, ownerless, no project managers. */
  const generalProject = { leadId: null, isSystem: true, name: 'General' };
  const issue = { projectId: 83, assigneeId: ASSIGNEE };

  /** The guard is private; this is the door every caller comes through. */
  const assert = (actor: number, role?: string) =>
    (service as any).assertCanCompleteOrArchive(COMPANY, actor, issue, role);

  beforeEach(() => {
    prisma = {
      project: { findUnique: jest.fn(async () => generalProject) },
      projectMember: { findFirst: jest.fn(async () => null) },
      employee: {
        count: jest.fn(async () => 0),
        findUnique: jest.fn(async () => ({ firstName: 'Mohit', lastName: 'Singh' })),
      },
    };
    service = new IssuesService(prisma, {} as any, {} as any);
    // The assignee reports to MANAGER and to nobody else.
    (service as any).getAssigneeUpperHierarchy = jest.fn(async () => [MANAGER]);
  });

  it.each(['ADMIN', 'SUPERADMIN'])('lets a %s through', async (role) => {
    await expect(assert(ADMIN, role)).resolves.toBeUndefined();
  });

  // The admin exemption must be the FIRST thing checked, not a branch reached
  // after a lookup — an ownerless project would otherwise fall past it.
  it('does not need the project to exist to let an administrator through', async () => {
    await assert(ADMIN, 'ADMIN');
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it('still lets the assignee’s manager through', async () => {
    await expect(assert(MANAGER, 'EMPLOYEE')).resolves.toBeUndefined();
  });

  it('still refuses the assignee signing off their own work', async () => {
    await expect(assert(ASSIGNEE, 'EMPLOYEE')).rejects.toThrow(/cannot sign off your own task/i);
  });

  // The old message said "only the assignee's manager (or above)", which sends
  // the reader to the org chart to work out who that is.
  it('names the person the task belongs to when it refuses', async () => {
    await expect(assert(BYSTANDER, 'EMPLOYEE')).rejects.toThrow(/Mohit Singh/);
  });

  it('does not offer a project manager as a route out on the General project', async () => {
    await expect(assert(BYSTANDER, 'EMPLOYEE')).rejects.not.toThrow(/project manager on this board/i);
  });
});
