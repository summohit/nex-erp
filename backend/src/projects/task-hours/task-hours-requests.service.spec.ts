import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TaskHoursRequestsService } from './task-hours-requests.service';

/**
 * §3: an employee runs out of hours on a task, asks for more, and the project
 * manager rules on it.
 *
 * What matters here is that approval actually moves the ceiling — the whole
 * point of the request is to unblock logging — that the decision and the move
 * happen together, and that nobody approves their own.
 */
const ISSUE = {
  id: 11, key: 'NEX-11', title: 'Wire the importer',
  assigneeId: 60, reporterId: 71,
  estimatedHours: 4, additionalHours: 0,
  project: {
    id: 3, name: 'Acme', leadId: 70,
    members: [{ employeeId: 71, role: 'PROJECT_MANAGER' }, { employeeId: 60, role: 'MEMBER' }],
  },
};

const REQUEST = {
  id: 5, issueId: 11, status: 'REQUESTED', requestedHours: 4, requestedById: 60,
};

function makeService(over: any = {}) {
  const prisma: any = {
    issue: {
      findFirst: jest.fn().mockResolvedValue(ISSUE),
      findUnique: jest.fn().mockResolvedValue({ additionalHours: ISSUE.additionalHours }),
      update: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
    },
    issueTimeLog: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { durationMin: 240 } }),
    },
    taskHoursRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 5, ...a.data })),
      update: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 5, ...a.data })),
    },
    taskHoursRequestActivity: {
      create: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
      findMany: jest.fn().mockResolvedValue([]),
    },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    project: { findMany: jest.fn().mockResolvedValue([]) },
    ...over,
  };
  prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));
  const notifications: any = {
    notifyEmployees: jest.fn().mockResolvedValue(1),
  };
  return {
    service: new TaskHoursRequestsService(prisma, notifications),
    prisma,
    notifications,
  };
}

describe('raising a request', () => {
  it('lets the assignee ask for more hours', async () => {
    const { service } = makeService();
    const r: any = await service.create(1, 60, 'EMPLOYEE', 11, {
      requestedHours: 4, reason: 'The import format changed',
    });
    expect(r.requestedHours).toBe(4);
    expect(r.status).toBe('REQUESTED');
  });

  it('records the raising on the timeline', async () => {
    const { service, prisma } = makeService();
    await service.create(1, 60, 'EMPLOYEE', 11, { requestedHours: 4, reason: 'why' });
    expect(prisma.taskHoursRequestActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CREATED', actorId: 60 }),
      }),
    );
  });

  it('refuses a stranger to the project', async () => {
    const { service } = makeService();
    await expect(
      service.create(1, 999, 'EMPLOYEE', 11, { requestedHours: 4, reason: 'why' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('insists on a reason, since that is what is being ruled on', async () => {
    const { service } = makeService();
    await expect(
      service.create(1, 60, 'EMPLOYEE', 11, { requestedHours: 4, reason: '  ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a second request while one is still open', async () => {
    const { service } = makeService({
      taskHoursRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: 9 }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
    });
    await expect(
      service.create(1, 60, 'EMPLOYEE', 11, { requestedHours: 4, reason: 'why' }),
    ).rejects.toThrow(/already .* awaiting a decision/);
  });
});

describe('reviewing a request', () => {
  const open = () => ({
    taskHoursRequest: {
      findFirst: jest.fn().mockResolvedValue(REQUEST),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 5, ...a.data })),
    },
  });

  it('raises the task ceiling by the approved hours', async () => {
    const { service, prisma } = makeService(open());
    await service.review(1, 71, 'EMPLOYEE', 5, 'APPROVED');
    expect(prisma.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { additionalHours: 4 } }),
    );
  });

  it('lets the manager grant less than was asked for', async () => {
    const { service, prisma } = makeService(open());
    const r: any = await service.review(1, 71, 'EMPLOYEE', 5, 'APPROVED', { approvedHours: 2 });
    expect(r.approvedHours).toBe(2);
    expect(prisma.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { additionalHours: 2 } }),
    );
  });

  it('records a reduction on the timeline, so the gap is visible', async () => {
    const { service, prisma } = makeService(open());
    await service.review(1, 71, 'EMPLOYEE', 5, 'APPROVED', { approvedHours: 2 });
    expect(prisma.taskHoursRequestActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'HOURS_MODIFIED', oldValue: '4', newValue: '2' }),
      }),
    );
  });

  it('adds to hours already granted rather than replacing them', async () => {
    const { service, prisma } = makeService({
      ...open(),
      issue: {
        findFirst: jest.fn().mockResolvedValue(ISSUE),
        findUnique: jest.fn().mockResolvedValue({ additionalHours: 3 }),
        update: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
      },
    });
    await service.review(1, 71, 'EMPLOYEE', 5, 'APPROVED');
    expect(prisma.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { additionalHours: 7 } }),
    );
  });

  it('leaves the ceiling alone on a rejection', async () => {
    const { service, prisma } = makeService(open());
    await service.review(1, 71, 'EMPLOYEE', 5, 'REJECTED', { reason: 'Re-scope instead' });
    expect(prisma.issue.update).not.toHaveBeenCalled();
  });

  it('insists on a reason when rejecting', async () => {
    const { service } = makeService(open());
    await expect(
      service.review(1, 71, 'EMPLOYEE', 5, 'REJECTED', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses somebody who does not manage the project', async () => {
    const { service } = makeService(open());
    await expect(
      service.review(1, 60, 'EMPLOYEE', 5, 'APPROVED'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to let the requester approve their own request', async () => {
    const { service } = makeService({
      taskHoursRequest: {
        // The PM raised it on their own task, which is ordinary.
        findFirst: jest.fn().mockResolvedValue({ ...REQUEST, requestedById: 71 }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
    });
    await expect(
      service.review(1, 71, 'EMPLOYEE', 5, 'APPROVED'),
    ).rejects.toThrow(/cannot approve your own/);
  });

  it('refuses to rule twice', async () => {
    const { service } = makeService({
      taskHoursRequest: {
        findFirst: jest.fn().mockResolvedValue({ ...REQUEST, status: 'APPROVED' }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
    });
    await expect(
      service.review(1, 71, 'EMPLOYEE', 5, 'APPROVED'),
    ).rejects.toThrow(/already approved/);
  });

  it('lets an administrator approve as well as the manager', async () => {
    const { service, prisma } = makeService(open());
    await service.review(1, 99, 'ADMIN', 5, 'APPROVED');
    expect(prisma.issue.update).toHaveBeenCalled();
  });
});

describe('the task hours summary', () => {
  it('reports assigned, logged and remaining together', async () => {
    const { service } = makeService();
    const r: any = await service.listForIssue(1, 11, 'EMPLOYEE', 60);
    expect(r.hours).toMatchObject({ assigned: 4, logged: 4, remaining: 0, allowed: 4 });
  });

  it('shows the approved hours in the remaining figure', async () => {
    const { service } = makeService({
      issue: {
        findFirst: jest.fn().mockResolvedValue({ ...ISSUE, additionalHours: 4 }),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    });
    const r: any = await service.listForIssue(1, 11, 'EMPLOYEE', 60);
    expect(r.hours).toMatchObject({ allowed: 8, logged: 4, remaining: 4 });
  });
});

/**
 * §3: a request nobody is told about is a request that sits until the person
 * waiting on it chases someone. Raising one used to write the row and the
 * activity entry and notify nobody at all, so the PM only ever found out by
 * opening the requests screen on the off chance.
 */
describe('telling the approvers a request is waiting', () => {
  const raise = (service: TaskHoursRequestsService) =>
    service.create(1, 60, 'EMPLOYEE', 11, {
      requestedHours: 4, reason: 'The import format changed',
    });

  it('notifies the project lead and the project managers', async () => {
    const { service, notifications } = makeService();
    await raise(service);

    expect(notifications.notifyEmployees).toHaveBeenCalledTimes(1);
    const [targets, opts] = notifications.notifyEmployees.mock.calls[0];
    // 70 leads the project, 71 is its PM. 60 is a MEMBER and does not rule.
    expect(new Set(targets)).toEqual(new Set([70, 71]));
    expect(targets).not.toContain(60);
    expect(opts.companyId).toBe(1);
  });

  it('marks it action-required so a mute cannot swallow it', async () => {
    const { service, notifications } = makeService();
    await raise(service);

    const [, opts] = notifications.notifyEmployees.mock.calls[0];
    expect(opts.type).toBe('ACTION_REQUIRED');
    expect(opts.linkUrl).toBe('/task-requests');
  });

  it('says who asked, for how long, and on which task', async () => {
    const { service, notifications } = makeService();
    await raise(service);

    const [, opts] = notifications.notifyEmployees.mock.calls[0];
    expect(opts.message).toContain('4h');
    expect(opts.message).toContain('NEX-11');
    expect(opts.message).toContain('Wire the importer');
  });

  it('never notifies the requester about their own request', async () => {
    // The PM raising one on their own task is ordinary; they should not then
    // be told that somebody is waiting on them.
    const { service, notifications } = makeService();
    await service.create(1, 71, 'EMPLOYEE', 11, {
      requestedHours: 2, reason: 'Scope grew',
    });

    const [, opts] = notifications.notifyEmployees.mock.calls[0];
    expect(opts.excludeEmployeeId).toBe(71);
  });

  it('does not notify before the row is committed', async () => {
    const { service, prisma, notifications } = makeService();
    prisma.$transaction = jest.fn().mockRejectedValue(new Error('rolled back'));

    await expect(raise(service)).rejects.toThrow('rolled back');
    expect(notifications.notifyEmployees).not.toHaveBeenCalled();
  });
});

describe('telling the requester what was decided', () => {
  const pending = {
    taskHoursRequest: {
      findFirst: jest.fn().mockResolvedValue(REQUEST),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn().mockImplementation((a: any) => Promise.resolve({
        id: 5, requestedHours: REQUEST.requestedHours,
        requestedBy: { id: REQUEST.requestedById }, ...a.data,
      })),
    },
  };

  it('tells the requester when their hours are approved', async () => {
    const { service, notifications } = makeService(pending);
    await service.review(1, 71, 'EMPLOYEE', 5, 'APPROVED');

    const [targets, opts] = notifications.notifyEmployees.mock.calls[0];
    expect(targets).toEqual([60]);
    expect(opts.type).toBe('SUCCESS');
    expect(opts.linkUrl).toBe('/projects/3?task=11');
  });

  it('says how many hours were granted when it is not what was asked for', async () => {
    const { service, notifications } = makeService(pending);
    await service.review(1, 71, 'EMPLOYEE', 5, 'APPROVED', { approvedHours: 2 });

    const [, opts] = notifications.notifyEmployees.mock.calls[0];
    expect(opts.message).toContain('4h requested, 2h approved');
  });

  it('tells the requester why it was declined', async () => {
    const { service, notifications } = makeService(pending);
    await service.review(1, 71, 'EMPLOYEE', 5, 'REJECTED', { reason: 'Re-scope it instead' });

    const [targets, opts] = notifications.notifyEmployees.mock.calls[0];
    expect(targets).toEqual([60]);
    expect(opts.type).toBe('WARNING');
    expect(opts.message).toContain('Re-scope it instead');
  });
});
