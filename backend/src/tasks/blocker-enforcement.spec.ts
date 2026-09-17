import { IssuesService } from '../projects/issues/issues.service';

/**
 * The one place a dependency stops somebody.
 *
 * Everywhere else an open blocker is a chip and a note — a stale blocker nobody
 * closed must not be able to halt real work, or people stop recording
 * dependencies at all. Moving into Review or Done is the exception: that is a
 * claim the task is finished, and it demonstrably is not while something it
 * waits on is still open.
 */
describe('IssuesService — blockers on the Review/Done transition', () => {
  let prisma: any;
  let service: IssuesService;
  let openBlockers: any[];

  beforeEach(() => {
    openBlockers = [];
    prisma = {
      issue: {
        findUnique: jest.fn(async () => ({
          id: 1, projectId: 10, companyId: 1, assigneeId: 4, columnId: 100, status: 'IN_PROGRESS',
        })),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({ id: 1 })),
      },
      issueDependency: { findMany: jest.fn(async () => openBlockers) },
      boardColumn: {
        findUnique: jest.fn(async () => ({ id: 200, name: 'Done', type: 'DONE', position: 3 })),
        findMany: jest.fn(async () => []),
      },
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
  });

  /** Reach past the permission layer to the blocker check itself. */
  const attemptDoneMove = async () => {
    jest.spyOn(service as any, 'assertCanCompleteOrArchive').mockResolvedValue(undefined);
    // (companyId, employeeId, projectId, issueId, data, role)
    return service.updateIssue(1, 4, 10, 1, { status: 'DONE' } as any, 'ADMIN');
  };

  it('allows the move when nothing is blocking', async () => {
    await expect(attemptDoneMove()).resolves.toBeDefined();
  });

  it('refuses the move while a blocker is open, and names it', async () => {
    openBlockers = [{ dependsOnIssue: { key: 'NEX-42', title: 'Do this first' } }];
    await expect(attemptDoneMove()).rejects.toThrow(/NEX-42/);
  });

  it('names every open blocker, not just the first', async () => {
    openBlockers = [
      { dependsOnIssue: { key: 'NEX-42', title: 'One' } },
      { dependsOnIssue: { key: 'NEX-43', title: 'Two' } },
    ];
    await expect(attemptDoneMove()).rejects.toThrow(/NEX-42, NEX-43/);
  });

  // The query — not the caller — is what excludes finished blockers, so a
  // blocker that is already DONE never reaches this check at all.
  it('only counts blockers that are still open', async () => {
    await attemptDoneMove();
    expect(prisma.issueDependency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'BLOCKS',
          dependsOnIssue: { status: { notIn: ['DONE', 'CANCELLED'] } },
        }),
      }),
    );
  });
});
