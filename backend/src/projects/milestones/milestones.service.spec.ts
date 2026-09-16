import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { MilestonesService } from './milestones.service';

/**
 * The rules worth pinning down are the two that cross a boundary: who may see
 * a milestone's money, and who may change one. The Prisma calls themselves are
 * stubbed — this is about the decisions around them.
 */
const PROJECT = {
  id: 1,
  leadId: 50,
  currency: 'INR',
  budgetAmount: 1000000,
  members: [
    { employeeId: 60, role: 'PROJECT_MANAGER' },
    { employeeId: 70, role: 'MEMBER' },
  ],
};

function makeService(over: any = {}) {
  const prisma: any = {
    project: { findFirst: jest.fn().mockResolvedValue(PROJECT) },
    projectMilestone: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 9, projectId: 1, status: 'PENDING' }),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 9, ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 9, ...data })),
      delete: jest.fn().mockResolvedValue({ id: 9 }),
    },
    $transaction: jest.fn().mockResolvedValue([]),
    ...over,
  };
  return { service: new MilestonesService(prisma), prisma };
}

const milestoneRow = (over: any = {}) => ({
  id: 9,
  projectId: 1,
  name: 'UAT sign-off',
  amount: 200000,
  percentage: 20,
  status: 'PENDING',
  owner: null,
  _count: { issues: 4 },
  issues: [{ status: 'DONE' }, { status: 'DONE' }, { status: 'TODO' }, { status: 'TODO' }],
  ...over,
});

describe('MilestonesService.list', () => {
  it('gives an ordinary member the milestone but not its value', async () => {
    const { service, prisma } = makeService();
    prisma.projectMilestone.findMany.mockResolvedValue([milestoneRow()]);

    const res = await service.list(1, 70, 'EMPLOYEE', 1);

    expect(res.canViewFinancials).toBe(false);
    expect(res.milestones[0].name).toBe('UAT sign-off');
    expect(res.milestones[0]).not.toHaveProperty('amount');
    expect(res.milestones[0]).not.toHaveProperty('percentage');
    // Totals are money, so an employee gets none at all rather than a zero.
    expect(res.totals).toBeNull();
  });

  it('gives the project manager the value and the unallocated remainder', async () => {
    const { service, prisma } = makeService();
    prisma.projectMilestone.findMany.mockResolvedValue([
      milestoneRow({ id: 1, amount: 200000 }),
      milestoneRow({ id: 2, amount: 300000 }),
    ]);

    const res = await service.list(1, 60, 'EMPLOYEE', 1);

    expect(res.canViewFinancials).toBe(true);
    expect(res.totals!.milestoneValue).toBe(500000);
    // ₹10L budget, ₹5L carved into milestones — the gap is the point.
    expect(res.totals!.unallocated).toBe(500000);
  });

  it('reports progress from the tasks booked against the milestone', async () => {
    const { service, prisma } = makeService();
    prisma.projectMilestone.findMany.mockResolvedValue([milestoneRow()]);

    const res = await service.list(1, 60, 'EMPLOYEE', 1);

    expect(res.milestones[0].progress).toBe(50);
  });

  // An empty milestone is not a finished one.
  it('calls a milestone with no tasks zero percent, not a hundred', async () => {
    const { service, prisma } = makeService();
    prisma.projectMilestone.findMany.mockResolvedValue([milestoneRow({ _count: { issues: 0 }, issues: [] })]);

    const res = await service.list(1, 60, 'EMPLOYEE', 1);

    expect(res.milestones[0].progress).toBe(0);
  });

  it('refuses someone who is not on the project at all', async () => {
    const { service } = makeService();
    await expect(service.list(1, 999, 'EMPLOYEE', 1)).rejects.toThrow(ForbiddenException);
  });

  it('lets finance in without being a member', async () => {
    const { service } = makeService();
    const res = await service.list(1, null, 'FINANCE', 1);
    expect(res.canViewFinancials).toBe(true);
  });

  it('404s on a project in another company', async () => {
    const { service, prisma } = makeService();
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.list(1, 60, 'ADMIN', 1)).rejects.toThrow(NotFoundException);
  });
});

describe('MilestonesService.create', () => {
  it('refuses an ordinary member', async () => {
    const { service } = makeService();
    await expect(service.create(1, 70, 'EMPLOYEE', 1, { name: 'x' })).rejects.toThrow(ForbiddenException);
  });

  it('requires a name', async () => {
    const { service } = makeService();
    await expect(service.create(1, 60, 'EMPLOYEE', 1, { name: '  ' })).rejects.toThrow(BadRequestException);
  });

  it('lets the project manager set an amount', async () => {
    const { service, prisma } = makeService();
    await service.create(1, 60, 'EMPLOYEE', 1, { name: 'Phase 1', amount: '200000', percentage: '20' });

    expect(prisma.projectMilestone.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 200000, percentage: 20 }) }),
    );
  });

  it('rejects an unknown status rather than storing it', async () => {
    const { service, prisma } = makeService();
    await service.create(1, 60, 'EMPLOYEE', 1, { name: 'Phase 1', status: 'NONSENSE' });

    expect(prisma.projectMilestone.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
    );
  });
});

describe('MilestonesService.update', () => {
  it('stamps completedAt when the milestone is first completed', async () => {
    const { service, prisma } = makeService();
    await service.update(1, 60, 'EMPLOYEE', 9, { status: 'COMPLETED' });

    const data = prisma.projectMilestone.update.mock.calls[0][0].data;
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  // The date a milestone was met decides when an invoice became eligible. It
  // must not move because somebody fixed a typo afterwards.
  it('does not re-stamp completedAt on an already-completed milestone', async () => {
    const { service, prisma } = makeService();
    prisma.projectMilestone.findFirst.mockResolvedValue({ id: 9, projectId: 1, status: 'COMPLETED' });

    await service.update(1, 60, 'EMPLOYEE', 9, { status: 'COMPLETED', name: 'UAT sign off' });

    expect(prisma.projectMilestone.update.mock.calls[0][0].data).not.toHaveProperty('completedAt');
  });

  it('clears completedAt when a milestone is reopened', async () => {
    const { service, prisma } = makeService();
    prisma.projectMilestone.findFirst.mockResolvedValue({ id: 9, projectId: 1, status: 'COMPLETED' });

    await service.update(1, 60, 'EMPLOYEE', 9, { status: 'IN_PROGRESS' });

    expect(prisma.projectMilestone.update.mock.calls[0][0].data.completedAt).toBeNull();
  });
});

describe('MilestonesService.reorder', () => {
  // Otherwise a crafted id list is a way to renumber another project's rows.
  it('refuses ids that belong to a different project', async () => {
    const { service, prisma } = makeService();
    prisma.projectMilestone.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await expect(service.reorder(1, 60, 'EMPLOYEE', 1, [1, 2, 3])).rejects.toThrow(BadRequestException);
  });

  it('writes the new order in one transaction', async () => {
    const { service, prisma } = makeService();
    prisma.projectMilestone.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await service.reorder(1, 60, 'EMPLOYEE', 1, [2, 1]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
