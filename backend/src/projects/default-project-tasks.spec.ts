import { ProjectsService } from './projects.service';

/**
 * §1: every new project starts with the six management tasks, assigned to its
 * project manager.
 *
 * What matters is who they land on, that they do not collide with the keys of
 * tasks raised afterwards, and that a failure here never costs the project.
 */
const DEFAULTS = [
  { id: 1, name: 'Project Planning and Management', description: 'Plan it', position: 0 },
  { id: 2, name: 'Project Plan Approval', description: 'Approve it', position: 1 },
  { id: 3, name: 'Project Sign-Off', description: 'Close it', position: 2 },
];

function make(over: any = {}) {
  const created: any[] = [];
  const prisma: any = {
    defaultProjectTask: { findMany: jest.fn().mockResolvedValue(DEFAULTS) },
    boardColumn: { findFirst: jest.fn().mockResolvedValue({ id: 10 }) },
    issue: {
      count: jest.fn().mockResolvedValue(0),
      createMany: jest.fn().mockImplementation((a: any) => {
        created.push(...a.data);
        return Promise.resolve({ count: a.data.length });
      }),
    },
    project: { update: jest.fn().mockResolvedValue({}) },
    ...over,
  };
  const service = new ProjectsService(prisma as any, {} as any);
  return { service, prisma, created };
}

const seed = (service: any, data: any = {}) =>
  (service as any).seedDefaultProjectTasks(
    1, { id: 7, key: 'CES/0926/03' }, 70, data,
  );

describe('default project tasks', () => {
  it('creates one task per active default', async () => {
    const { service, created } = make();
    await seed(service);
    expect(created).toHaveLength(3);
    expect(created.map((t) => t.title)).toEqual([
      'Project Planning and Management', 'Project Plan Approval', 'Project Sign-Off',
    ]);
  });

  it('carries the description through, so the task says what it means', async () => {
    const { service, created } = make();
    await seed(service);
    expect(created[0].description).toBe('Plan it');
  });

  it('assigns them to the first project manager named on the form', async () => {
    const { service, created } = make();
    await seed(service, { pmIds: [88, 89] });
    expect(created.every((t) => t.assigneeId === 88)).toBe(true);
  });

  it('falls back to the project lead when no manager was chosen', async () => {
    const { service, created } = make();
    await seed(service, { pmIds: [] });
    expect(created.every((t) => t.assigneeId === 70)).toBe(true);
  });

  it('ignores junk in pmIds rather than assigning to nobody', async () => {
    const { service, created } = make();
    await seed(service, { pmIds: [null, 0, 'x'] });
    expect(created.every((t) => t.assigneeId === 70)).toBe(true);
  });

  it('puts them in the To Do column', async () => {
    const { service, created } = make();
    await seed(service);
    expect(created.every((t) => t.columnId === 10)).toBe(true);
  });

  it('numbers the keys from one', async () => {
    const { service, created } = make();
    await seed(service);
    expect(created.map((t) => t.key)).toEqual([
      'CES/0926/03-1', 'CES/0926/03-2', 'CES/0926/03-3',
    ]);
  });

  // Without this the first task raised by hand reuses a key these already
  // hold, and @@unique([key, companyId]) turns that into a 500.
  it('advances issueSeq past the tasks it created', async () => {
    const { service, prisma } = make();
    await seed(service);
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { issueSeq: 3 } }),
    );
  });

  it('does nothing when a company has retired all of them', async () => {
    const { service, prisma } = make({
      defaultProjectTask: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await seed(service);
    expect(prisma.issue.createMany).not.toHaveBeenCalled();
  });

  // A project that exists without its checklist is a nuisance. A project
  // creation that throws after the project row is committed is a broken
  // half-project the user cannot retry.
  it('never lets a failure here break project creation', async () => {
    const { service } = make({
      issue: { createMany: jest.fn().mockRejectedValue(new Error('db down')) },
    });
    await expect(seed(service)).resolves.toBeUndefined();
  });
});


/**
 * Kickoff runs the same seeding on a project that already has tasks: the AI
 * analysis has just written its own, numbered from one.
 */
describe('seeding onto a project that already has tasks', () => {
  const withExisting = (n: number) => make({
    issue: {
      count: jest.fn().mockResolvedValue(n),
      createMany: jest.fn().mockImplementation((a: any) => Promise.resolve({ count: a.data.length })),
    },
  });

  it('numbers keys after the tasks already there, not from one', async () => {
    const { service, prisma } = withExisting(12);
    await seed(service);
    const written = prisma.issue.createMany.mock.calls[0][0].data;
    expect(written.map((t: any) => t.key)).toEqual([
      'CES/0926/03-13', 'CES/0926/03-14', 'CES/0926/03-15',
    ]);
  });

  it('positions them after the existing tasks', async () => {
    const { service, prisma } = withExisting(12);
    await seed(service);
    const written = prisma.issue.createMany.mock.calls[0][0].data;
    expect(written.map((t: any) => t.position)).toEqual([12, 13, 14]);
  });

  it('advances issueSeq past everything, not just its own rows', async () => {
    const { service, prisma } = withExisting(12);
    await seed(service);
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { issueSeq: 15 } }),
    );
  });
});
