import { TasksService } from './tasks.service';

/**
 * The parts of the task service that are easy to get quietly wrong.
 *
 * Two things matter more than the rest here. A dependency graph that accepts a
 * cycle produces a task list nobody can ever finish, and the My Tasks feed
 * reaches into pre-sales — where the whole point of maskLeadsForPreSales is
 * that a pre-sales member must not see a deal's money.
 */
describe('TasksService', () => {
  let prisma: any;
  let crm: any;
  let service: TasksService;
  let dependencies: { issueId: number; dependsOnIssueId: number }[];

  beforeEach(() => {
    dependencies = [];
    prisma = {
      issueDependency: {
        findMany: jest.fn(async () => dependencies),
      },
      issue: { findMany: jest.fn(async () => []) },
      employee: { findFirst: jest.fn(async () => null) },
    };
    crm = { getMyPreSalesTasks: jest.fn(async () => []) };
    service = new TasksService(prisma, {} as any, {} as any, crm);
  });

  describe('dependency cycles', () => {
    const edge = (issueId: number, dependsOnIssueId: number) =>
      dependencies.push({ issueId, dependsOnIssueId });

    it('refuses a task depending on itself', async () => {
      await expect(service.assertNoDependencyCycle(1, 5, 5)).rejects.toThrow(/cannot depend on itself/i);
    });

    it('allows an ordinary dependency', async () => {
      await expect(service.assertNoDependencyCycle(1, 5, 6)).resolves.toBeUndefined();
    });

    it('refuses a direct loop: B already waits on A, so A cannot wait on B', async () => {
      edge(6, 5); // 6 depends on 5
      await expect(service.assertNoDependencyCycle(1, 5, 6)).rejects.toThrow(/circular/i);
    });

    it('refuses a loop three hops away', async () => {
      edge(6, 7);
      edge(7, 8);
      edge(8, 5); // 5 -> 6 -> 7 -> 8 -> 5
      await expect(service.assertNoDependencyCycle(1, 5, 6)).rejects.toThrow(/circular/i);
    });

    // Two paths to the same ancestor is not a cycle, and refusing it would be
    // a bug people would work around by not recording dependencies at all.
    it('allows a diamond', async () => {
      edge(6, 8);
      edge(7, 8);
      await expect(service.assertNoDependencyCycle(1, 5, 6)).resolves.toBeUndefined();
    });

    it('terminates on a graph that already contains a loop', async () => {
      edge(6, 7);
      edge(7, 6);
      await expect(service.assertNoDependencyCycle(1, 99, 6)).resolves.toBeUndefined();
    });
  });

  describe('My Tasks', () => {
    const issueRow = (o: Partial<any> = {}) => ({
      id: 1, key: 'NEX-1', title: 'Ship it', status: 'TODO', priority: 'HIGH',
      startDate: null, dueDate: null, estimatedHours: 3,
      project: { id: 10, name: 'Website', isSystem: false },
      lead: null, taskType: { name: 'Development' },
      assignee: { id: 4, firstName: 'Ada', lastName: 'L', avatarUrl: null },
      members: [], blockedBy: [], ...o,
    });

    beforeEach(() => {
      prisma.issue.findMany = jest.fn(async () => [issueRow()]);
    });

    it('labels a project task and links to its project', async () => {
      const { items } = await service.getMyTasks(1, 4, 'EMPLOYEE');
      expect(items[0]).toMatchObject({
        source: 'PROJECT',
        refKey: 'NEX-1',
        parent: { kind: 'PROJECT', id: 10, name: 'Website' },
        link: { route: '/projects/10', queryParams: { task: '1' } },
      });
    });

    // The General project is an implementation detail of "this task has no
    // project" — it must never be presented as one.
    it('presents a task in the General project as General, not as a project', async () => {
      prisma.issue.findMany = jest.fn(async () => [
        issueRow({ project: { id: 99, name: 'General', isSystem: true } }),
      ]);
      const { items } = await service.getMyTasks(1, 4, 'EMPLOYEE');
      expect(items[0].source).toBe('GENERAL');
      expect(items[0].parent).toMatchObject({ kind: 'GENERAL', name: 'General' });
    });

    it('shows a lead-linked general task under its deal', async () => {
      prisma.issue.findMany = jest.fn(async () => [
        issueRow({
          project: { id: 99, name: 'General', isSystem: true },
          lead: { id: 77, companyName: 'Acme Ltd', contactName: null },
        }),
      ]);
      const { items } = await service.getMyTasks(1, 4, 'EMPLOYEE');
      expect(items[0].parent).toMatchObject({ kind: 'LEAD', id: 77, name: 'Acme Ltd' });
    });

    it('lists only open blockers, since a closed one blocks nothing', async () => {
      prisma.issue.findMany = jest.fn(async () => [
        issueRow({
          blockedBy: [
            { dependsOnIssue: { id: 2, key: 'NEX-2', title: 'Open', status: 'TODO' } },
            { dependsOnIssue: { id: 3, key: 'NEX-3', title: 'Finished', status: 'DONE' } },
          ],
        }),
      ]);
      const { items } = await service.getMyTasks(1, 4, 'EMPLOYEE');
      expect(items[0].blockedBy).toEqual([{ id: 2, refKey: 'NEX-2', title: 'Open' }]);
    });

    it('prefers the full member list over the single assignee', async () => {
      prisma.issue.findMany = jest.fn(async () => [
        issueRow({
          members: [
            { employee: { id: 4, firstName: 'Ada', lastName: 'L', avatarUrl: null } },
            { employee: { id: 5, firstName: 'Grace', lastName: 'H', avatarUrl: null } },
          ],
        }),
      ]);
      const { items } = await service.getMyTasks(1, 4, 'EMPLOYEE');
      expect(items[0].assignees.map((a) => a.id)).toEqual([4, 5]);
    });

    it('goes through CrmService for pre-sales rather than querying them here', async () => {
      await service.getMyTasks(1, 4, 'EMPLOYEE');
      expect(crm.getMyPreSalesTasks).toHaveBeenCalledWith(1, 4, expect.any(Object));
      expect(prisma.preSalesTask).toBeUndefined();
    });

    it('sorts newest assigned first, with undated work last', async () => {
      prisma.issue.findMany = jest.fn(async () => [
        issueRow({ id: 1, createdAt: new Date('2026-09-01') }),
        issueRow({ id: 2, createdAt: new Date('2026-09-15') }),
      ]);
      crm.getMyPreSalesTasks = jest.fn(async () => [
        { source: 'PRE_SALES', id: 9, createdAt: new Date('2026-09-20') } as any,
      ]);
      const { items } = await service.getMyTasks(1, 4, 'EMPLOYEE');
      expect(items.map((i) => i.id)).toEqual([9, 2, 1]);
    });

    it('excludes finished work unless asked for it', async () => {
      await service.getMyTasks(1, 4, 'EMPLOYEE');
      const where = prisma.issue.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ notIn: ['DONE', 'CANCELLED'] });

      await service.getMyTasks(1, 4, 'EMPLOYEE', { includeDone: true });
      expect(prisma.issue.findMany.mock.calls[1][0].where.status).toBeUndefined();
    });

    // Tasks you raised for other people answer a different question from
    // "what do I have to do". Opt-in, not the default.
    it('does not fold in tasks you merely reported', async () => {
      await service.getMyTasks(1, 4, 'EMPLOYEE');
      const or = prisma.issue.findMany.mock.calls[0][0].where.OR;
      expect(JSON.stringify(or)).not.toContain('reporterId');

      await service.getMyTasks(1, 4, 'EMPLOYEE', { includeReported: true });
      const or2 = prisma.issue.findMany.mock.calls[1][0].where.OR;
      expect(JSON.stringify(or2)).toContain('reporterId');
    });
  });

  /**
   * The ownership filter used to be unconditional, so an administrator with
   * nothing assigned to them opened My Tasks onto an empty screen while the
   * company had open work everywhere. `scope: 'all'` is the fix, and the role
   * check lives in the service so no caller can route around it.
   */
  describe('the company-wide scope', () => {
    beforeEach(() => {
      prisma.issue.findMany = jest.fn(async () => []);
    });

    const whereOfLastCall = () => prisma.issue.findMany.mock.calls.at(-1)[0].where;

    it('still filters by ownership when nobody asked for everything', async () => {
      const res = await service.getMyTasks(1, 4, 'ADMIN');
      expect(whereOfLastCall().OR).toBeDefined();
      expect(res.scope).toBe('mine');
    });

    it.each(['ADMIN', 'SUPERADMIN'])('drops the ownership filter for %s', async (role) => {
      const res = await service.getMyTasks(1, 4, role, { scope: 'all' });
      expect(whereOfLastCall().OR).toBeUndefined();
      expect(whereOfLastCall().companyId).toBe(1);
      expect(res.scope).toBe('all');
      expect(crm.getMyPreSalesTasks).toHaveBeenLastCalledWith(1, 4, expect.objectContaining({ everyone: true }));
    });

    // Downgraded rather than refused: the toggle is not rendered for them, so
    // a scope=all here is a hand-typed query string, not a user's mistake.
    it('quietly gives a non-admin their own list instead of everyone’s', async () => {
      const res = await service.getMyTasks(1, 4, 'EMPLOYEE', { scope: 'all' });
      expect(whereOfLastCall().OR).toBeDefined();
      expect(res.scope).toBe('mine');
      expect(crm.getMyPreSalesTasks).toHaveBeenLastCalledWith(1, 4, expect.objectContaining({ everyone: false }));
    });

    // A company-wide list is still a task list: archived and finished work
    // stays out of it unless it was asked for.
    it('does not also widen to archived or finished work', async () => {
      await service.getMyTasks(1, 4, 'ADMIN', { scope: 'all' });
      expect(whereOfLastCall().isArchived).toBe(false);
      expect(whereOfLastCall().status).toEqual({ notIn: ['DONE', 'CANCELLED'] });
    });
  });
});
