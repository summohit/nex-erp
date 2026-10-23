import { IssuesService } from '../issues/issues.service';

/**
 * A task carried out at several locations reaches Done through its locations.
 * A manual move to Done while some are open is refused, except by an
 * administrator who explicitly overrides — and that is recorded.
 */
describe('IssuesService — open locations on the Done transition', () => {
  let service: IssuesService;
  let prisma: any;
  let locationRows: { status: string }[];

  beforeEach(() => {
    locationRows = [];
    prisma = {
      issue: {
        findUnique: jest.fn(async () => ({
          id: 1, projectId: 10, companyId: 1, assigneeId: 4, columnId: 100, status: 'IN_PROGRESS',
        })),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({ id: 1 })),
      },
      issueDependency: { findMany: jest.fn(async () => []) },
      issueLocation: { findMany: jest.fn(async () => locationRows) },
      boardColumn: {
        findUnique: jest.fn(async () => ({ id: 200, name: 'Done', type: 'DONE', position: 3 })),
        findMany: jest.fn(async () => []),
      },
      projectMember: { findFirst: jest.fn(async () => null) },
      rolePermission: { findFirst: jest.fn(async () => null) },
      project: {
        findFirst: jest.fn(async () => ({ leadId: 4 })),
        findUnique: jest.fn(async () => ({ leadId: 4, name: 'Website' })),
      },
      employee: {
        findFirst: jest.fn(async () => ({ department: { canCreateTasks: false } })),
        findUnique: jest.fn(async () => ({ firstName: 'Ada', lastName: 'L' })),
      },
      issueActivity: { create: jest.fn(async () => ({})) },
      issueMember: { findMany: jest.fn(async () => []) },
      issueTimeLog: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
    };
    service = new IssuesService(
      prisma,
      { emitIssueUpdated: jest.fn(), emitActivityAdded: jest.fn() } as any,
      { notifyEmployees: jest.fn(async () => 0), createNotification: jest.fn(async () => ({})) } as any,
      { onIssueStatusChanged: jest.fn() } as any,
    );
    jest.spyOn(service as any, 'assertCanCompleteOrArchive').mockResolvedValue(undefined);
  });

  const moveToDone = (role: string, extra: any = {}) =>
    service.updateIssue(1, 4, 10, 1, { status: 'DONE', ...extra } as any, role);

  it('allows Done when every location is completed', async () => {
    locationRows = [{ status: 'COMPLETED' }, { status: 'COMPLETED' }];
    await expect(moveToDone('ADMIN')).resolves.toBeDefined();
  });

  it('refuses Done while locations are open, saying how many', async () => {
    locationRows = [{ status: 'COMPLETED' }, { status: 'IN_PROGRESS' }, { status: 'BLOCKED' }];
    await expect(moveToDone('ADMIN')).rejects.toThrow(/2 of 3 locations are still open/);
  });

  it('lets an administrator override, and records it', async () => {
    locationRows = [{ status: 'NOT_STARTED' }];
    await expect(moveToDone('ADMIN', { overrideOpenLocations: true })).resolves.toBeDefined();
    expect(prisma.issueActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'LOCATION_OVERRIDE' }) }),
    );
  });

  it('ignores the override flag from anyone but an administrator', async () => {
    locationRows = [{ status: 'NOT_STARTED' }];
    await expect(moveToDone('EMPLOYEE', { overrideOpenLocations: true, completionRemark: 'done' }))
      .rejects.toThrow(/still open/);
  });
});
