import { IssuesService } from './issues.service';

describe('IssuesService completion and cancellation access', () => {
  const COMPANY = 1;
  const PROJECT = 83;
  const PROJECT_MANAGER = 6;
  const EMPLOYEE = 7;
  const issue = { projectId: PROJECT, assigneeId: EMPLOYEE };

  let prisma: any;
  let service: IssuesService;

  const assert = (actor: number, role?: string) =>
    (service as any).assertCanCompleteOrArchive(COMPANY, actor, issue, role);

  beforeEach(() => {
    prisma = {
      projectMember: { findFirst: jest.fn(async ({ where }: any) =>
        where.employeeId === PROJECT_MANAGER && where.role === 'PROJECT_MANAGER' ? { id: 1 } : null),
      },
    };
    service = new IssuesService(prisma, {} as any, {} as any, { onIssueStatusChanged: jest.fn() } as any);
  });

  it('lets a Super Admin complete or cancel any task', async () => {
    await expect(assert(EMPLOYEE, 'SUPERADMIN')).resolves.toBeUndefined();
    expect(prisma.projectMember.findFirst).not.toHaveBeenCalled();
  });

  it('lets the project manager complete or cancel any task on their board', async () => {
    await expect(assert(PROJECT_MANAGER, 'EMPLOYEE')).resolves.toBeUndefined();
  });

  it('refuses an assignee, coordinator, and technical architect', async () => {
    await expect(assert(EMPLOYEE, 'EMPLOYEE')).rejects.toThrow(/Project Manager or Super Admin/i);
    await expect(assert(8, 'EMPLOYEE')).rejects.toThrow(/Project Manager or Super Admin/i);
    await expect(assert(9, 'EMPLOYEE')).rejects.toThrow(/Project Manager or Super Admin/i);
  });
});
