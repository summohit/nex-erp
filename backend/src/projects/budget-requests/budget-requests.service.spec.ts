import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BudgetRequestsService } from './budget-requests.service';

/**
 * §25: a PM asks for more hours or budget, an administrator approves, and the
 * project changes.
 *
 * Three things are worth pinning down. That approval actually moves the
 * project — an approval nobody honoured is worse than a refusal. That the
 * before/after figures are the ones actually moved, since a request can sit
 * for a week. And that these rows obey Rule 1: a budget request is nothing but
 * budget, so anybody who may not see a project's money may not see them.
 */
const PROJECT = {
  id: 3,
  leadId: 70,
  estimatedHours: 2000,
  budgetAmount: 1_000_000,
  currency: 'INR',
  members: [{ employeeId: 71, role: 'PROJECT_MANAGER' }, { employeeId: 60, role: 'MEMBER' }],
};

const REQUEST = {
  id: 5,
  projectId: 3,
  status: 'PENDING',
  additionalHours: 500,
  additionalBudget: 200_000,
};

function makeService(over: any = {}) {
  const prisma: any = {
    project: {
      findFirst: jest.fn().mockResolvedValue(PROJECT),
      findUnique: jest.fn().mockResolvedValue({
        estimatedHours: PROJECT.estimatedHours,
        budgetAmount: PROJECT.budgetAmount,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    projectBudgetRequest: {
      findFirst: jest.fn().mockResolvedValue(REQUEST),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
      update: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
    },
    ...over,
  };
  prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));
  return { service: new BudgetRequestsService(prisma), prisma };
}

describe('raising a request', () => {
  it('lets the project lead ask', async () => {
    const { service } = makeService();
    await expect(
      service.create(1, 70, 'EMPLOYEE', 3, { additionalHours: 500, reason: 'Client added a site' }),
    ).resolves.toBeDefined();
  });

  it('lets a project manager on the project ask', async () => {
    const { service } = makeService();
    await expect(
      service.create(1, 71, 'EMPLOYEE', 3, { additionalBudget: 50000, reason: 'Extra hardware' }),
    ).resolves.toBeDefined();
  });

  // An ordinary member of the project is not a manager of it.
  it('refuses a member who does not manage the project', async () => {
    const { service } = makeService();
    await expect(
      service.create(1, 60, 'EMPLOYEE', 3, { additionalHours: 10, reason: 'because' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a request that asks for nothing', async () => {
    const { service } = makeService();
    await expect(
      service.create(1, 70, 'ADMIN', 3, { reason: 'just checking' }),
    ).rejects.toThrow(/additional hours, additional budget, or both/);
  });

  // Zero is not an amount, and a request for zero is not a request.
  it('treats zero as not asked for', async () => {
    const { service } = makeService();
    await expect(
      service.create(1, 70, 'ADMIN', 3, { additionalHours: 0, additionalBudget: 0, reason: 'x' }),
    ).rejects.toThrow(/additional hours, additional budget, or both/);
  });

  it('refuses a negative amount rather than quietly reducing the budget', async () => {
    const { service } = makeService();
    await expect(
      service.create(1, 70, 'ADMIN', 3, { additionalBudget: -5000, reason: 'x' }),
    ).rejects.toThrow(/increase, not a reduction/);
  });

  // The reason is what the approver rules on.
  it('insists on a reason', async () => {
    const { service } = makeService();
    await expect(
      service.create(1, 70, 'ADMIN', 3, { additionalHours: 100, reason: '   ' }),
    ).rejects.toThrow(/reason is required/);
  });

  it('keeps the supporting attachment', async () => {
    const { service, prisma } = makeService();
    await service.create(1, 70, 'ADMIN', 3, {
      additionalHours: 100, reason: 'Scope grew',
      attachmentUrl: 'https://cdn/req.pdf', attachmentName: 'Client request.pdf',
    });
    const data = prisma.projectBudgetRequest.create.mock.calls[0][0].data;
    expect(data.attachmentUrl).toBe('https://cdn/req.pdf');
    expect(data.attachmentName).toBe('Client request.pdf');
  });
});

describe('approving a request', () => {
  it('refuses anybody who is not an administrator', async () => {
    const { service } = makeService();
    await expect(service.review(1, 70, 'EMPLOYEE', 5, 'APPROVED')).rejects.toThrow(ForbiddenException);
  });

  it('requires a reason to reject', async () => {
    const { service } = makeService();
    await expect(service.review(1, 80, 'ADMIN', 5, 'REJECTED', ' ')).rejects.toThrow(/reason is required/);
  });

  it('leaves the project alone when rejected', async () => {
    const { service, prisma } = makeService();
    await service.review(1, 80, 'ADMIN', 5, 'REJECTED', 'Not this quarter');
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  /** The point of the whole feature: approval moves the project. */
  it('applies both increases to the project', async () => {
    const { service, prisma } = makeService();
    await service.review(1, 80, 'ADMIN', 5, 'APPROVED');

    expect(prisma.project.update.mock.calls[0][0].data).toEqual({
      estimatedHours: 2500,
      budgetAmount: 1_200_000,
    });
  });

  it('records both sides of the move, so the history reads 2,000 to 2,500', async () => {
    const { service, prisma } = makeService();
    await service.review(1, 80, 'ADMIN', 5, 'APPROVED');

    const data = prisma.projectBudgetRequest.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: 'APPROVED',
      hoursBefore: 2000, hoursAfter: 2500,
      budgetBefore: 1_000_000, budgetAfter: 1_200_000,
    });
  });

  // Asking for hours only must not touch the budget, nor record a move in it.
  it('leaves untouched whichever figure was not asked for', async () => {
    const { service, prisma } = makeService({
      projectBudgetRequest: {
        findFirst: jest.fn().mockResolvedValue({ ...REQUEST, additionalBudget: null }),
        update: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
      },
    });
    await service.review(1, 80, 'ADMIN', 5, 'APPROVED');

    expect(prisma.project.update.mock.calls[0][0].data).toEqual({ estimatedHours: 2500 });
    const data = prisma.projectBudgetRequest.update.mock.calls[0][0].data;
    expect(data.budgetBefore).toBe(1_000_000);
    expect(data.budgetAfter).toBe(1_000_000);
  });

  // "Add 500 to nothing" is 500, not null.
  it('starts from zero when the project had no figure at all', async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue({ estimatedHours: null, budgetAmount: null });

    await service.review(1, 80, 'ADMIN', 5, 'APPROVED');

    expect(prisma.project.update.mock.calls[0][0].data).toEqual({
      estimatedHours: 500,
      budgetAmount: 200_000,
    });
  });

  /**
   * The figures recorded must be the ones actually moved. A request can sit
   * for a week while the project changes underneath it.
   */
  it('measures against the project as it is at approval, not at request', async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue({ estimatedHours: 2200, budgetAmount: 1_500_000 });

    await service.review(1, 80, 'ADMIN', 5, 'APPROVED');

    const data = prisma.projectBudgetRequest.update.mock.calls[0][0].data;
    expect(data.hoursBefore).toBe(2200);
    expect(data.hoursAfter).toBe(2700);
  });

  it('refuses to rule on the same request twice', async () => {
    const { service, prisma } = makeService();
    prisma.projectBudgetRequest.findFirst.mockResolvedValue({ ...REQUEST, status: 'APPROVED' });
    await expect(service.review(1, 80, 'ADMIN', 5, 'APPROVED')).rejects.toThrow(/already approved/);
  });

  it('404s on a request that is not there', async () => {
    const { service, prisma } = makeService();
    prisma.projectBudgetRequest.findFirst.mockResolvedValue(null);
    await expect(service.review(1, 80, 'ADMIN', 5, 'APPROVED')).rejects.toThrow(NotFoundException);
  });
});

/**
 * Rule 1. These rows are nothing but budget, so the read test is the same one
 * the project's own money fields use — not a weaker one.
 */
describe('who may read the history', () => {
  it('refuses an employee with no financial access', async () => {
    const { service } = makeService();
    await expect(service.list(1, 3, 'EMPLOYEE', 60)).rejects.toThrow(ForbiddenException);
  });

  it('allows the project lead', async () => {
    const { service } = makeService();
    await expect(service.list(1, 3, 'EMPLOYEE', 70)).resolves.toBeDefined();
  });

  it('allows finance, who may read money everywhere', async () => {
    const { service } = makeService();
    await expect(service.list(1, 3, 'FINANCE', 999)).resolves.toBeDefined();
  });

  // Finance reads the money; asking for more of it is the delivery manager's
  // job, so the two permissions are reported separately.
  it('tells finance they may not raise one', async () => {
    const { service } = makeService();
    const out = await service.list(1, 3, 'FINANCE', 999);
    expect(out.canRequest).toBe(false);
    expect(out.canApprove).toBe(false);
  });

  it('reports what a new request would be measured against', async () => {
    const { service } = makeService();
    const out = await service.list(1, 3, 'ADMIN', 80);
    expect(out.current).toEqual({ estimatedHours: 2000, budgetAmount: 1_000_000 });
    expect(out.canApprove).toBe(true);
  });

  it('refuses a non-administrator the cross-project queue', async () => {
    const { service } = makeService();
    await expect(service.pending(1, 'EMPLOYEE')).rejects.toThrow(ForbiddenException);
  });
});
