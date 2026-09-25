import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FieldVisitRequestsService, FIELD_VISIT_STATUS } from './field-visit-requests.service';
import { FieldVisitActivationService } from './field-visit-activation.service';

/**
 * §1–§3: a project manager asks to take three people to a client site for
 * three days, and an administrator rules on it.
 *
 * What matters here is who is allowed to decide — a trip commits other
 * people's working days — and that the request cannot describe something
 * incoherent, because approval turns it directly into tasks and an attendance
 * schedule that people are then held to.
 */

const PM = 71;
const ADMIN_EMP = 90;
const MEMBERS = [60, 61, 62];

const PROJECT = {
  id: 3, name: 'Acme Rollout', key: 'ACME', leadId: 70,
  members: [
    { employeeId: 71, role: 'PROJECT_MANAGER' },
    { employeeId: 60, role: 'MEMBER' },
  ],
};

/** A valid request body — three days, three people, two tasks. */
function body(over: any = {}) {
  return {
    projectId: 3,
    location: 'Client Site – Delhi',
    latitude: 28.6139,
    longitude: 77.209,
    startDate: '2026-09-22',
    endDate: '2026-09-24',
    visitDays: 3,
    startTime: '09:00',
    endTime: '18:00',
    employeeIds: [...MEMBERS],
    tasks: [{ name: 'Site Inspection' }, { name: 'Network Configuration' }],
    ...over,
  };
}

const PENDING_REQUEST = {
  id: 9, requestNumber: 'FVR-0009', status: FIELD_VISIT_STATUS.PENDING,
  raisedById: PM, location: 'Client Site – Delhi',
  startDate: new Date('2026-09-22T00:00:00.000Z'),
  endDate: new Date('2026-09-24T00:00:00.000Z'),
  visitDays: 3,
  project: { id: 3, name: 'Acme Rollout' },
  members: MEMBERS.map((employeeId) => ({ employeeId })),
};

function makeService(over: any = {}) {
  const prisma: any = {
    project: { findFirst: jest.fn().mockResolvedValue(PROJECT) },
    employee: {
      findMany: jest.fn().mockImplementation((a: any) =>
        Promise.resolve((a.where.id.in as number[]).map((id) => ({ id })))),
    },
    fieldVisitRequest: {
      count: jest.fn().mockResolvedValue(6),
      findFirst: jest.fn().mockResolvedValue(PENDING_REQUEST),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((a: any) =>
        Promise.resolve({ id: 9, raisedBy: { id: PM }, ...a.data })),
      update: jest.fn().mockImplementation((a: any) =>
        Promise.resolve({ id: 9, requestNumber: 'FVR-0009', ...a.data })),
    },
    fieldVisitRequestMember: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    fieldVisitRequestTask: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    fieldVisitRequestActivity: {
      create: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...over,
  };
  prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));

  const notifications: any = {
    notifyEmployees: jest.fn().mockResolvedValue(1),
    notifyApprovers: jest.fn().mockResolvedValue(1),
  };
  // The fan-out has its own tests; here it stands in for "approval committed
  // twelve tasks and nine days", so the lifecycle can be checked around it.
  const activation: any = {
    activate: jest.fn().mockResolvedValue({ issues: 12, attendanceDays: 9, rosterEntries: 9 }),
    deactivate: jest.fn().mockResolvedValue({ issues: 12, attendanceDays: 9, rosterEntries: 9 }),
  };
  return {
    service: new FieldVisitRequestsService(prisma, notifications, activation),
    prisma,
    notifications,
    activation,
  };
}

/** The activities written in a call, as action strings. */
function actions(prisma: any): string[] {
  return prisma.fieldVisitRequestActivity.create.mock.calls.map((c: any[]) => c[0].data.action);
}

describe('raising a request', () => {
  it('numbers it after the requests the company already has', async () => {
    const { service, prisma } = makeService();
    await service.create(1, PM, 'EMPLOYEE', body() as any);
    expect(prisma.fieldVisitRequest.create.mock.calls[0][0].data.requestNumber).toBe('FVR-0007');
  });

  it('starts as a draft, and records who created it', async () => {
    const { service, prisma } = makeService();
    const created = await service.create(1, PM, 'EMPLOYEE', body() as any);
    expect(created.status).toBe(FIELD_VISIT_STATUS.DRAFT);
    expect(created.submittedAt).toBeNull();
    expect(actions(prisma)).toEqual(['CREATED']);
  });

  it('submits in the same breath when the form said so, and tells the approvers', async () => {
    const { service, prisma, notifications } = makeService();
    const created = await service.create(1, PM, 'EMPLOYEE', body({ submit: true }) as any);
    expect(created.status).toBe(FIELD_VISIT_STATUS.PENDING);
    expect(actions(prisma)).toEqual(['CREATED', 'SUBMITTED']);
    expect(notifications.notifyApprovers).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ACTION_REQUIRED' }),
    );
  });

  it('refuses somebody who neither runs the project nor administers the company', async () => {
    const { service } = makeService();
    await expect(service.create(1, 60, 'EMPLOYEE', body() as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a day count that disagrees with the dates', async () => {
    const { service } = makeService();
    // 22nd to 24th is three days, whatever the form believes.
    await expect(service.create(1, PM, 'EMPLOYEE', body({ visitDays: 2 }) as any))
      .rejects.toThrow(/is 3 day\(s\), not 2/);
  });

  it('refuses a visit that ends before it starts', async () => {
    const { service } = makeService();
    await expect(service.create(1, PM, 'EMPLOYEE', body({ endDate: '2026-09-21' }) as any))
      .rejects.toThrow(/cannot end before it starts/);
  });

  it('refuses a date that does not exist', async () => {
    const { service } = makeService();
    await expect(service.create(1, PM, 'EMPLOYEE', body({ startDate: '2026-02-31', endDate: '2026-02-31', visitDays: 1 }) as any))
      .rejects.toThrow(/not a real date/);
  });

  it('refuses the empty map picker, which reads as a real place', async () => {
    const { service } = makeService();
    await expect(service.create(1, PM, 'EMPLOYEE', body({ latitude: 0, longitude: 0 }) as any))
      .rejects.toThrow(/Pick the site on the map/);
  });

  it('refuses a trip with nobody on it', async () => {
    const { service } = makeService();
    await expect(service.create(1, PM, 'EMPLOYEE', body({ employeeIds: [] }) as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a trip with no tasks, since approval has nothing to assign', async () => {
    const { service } = makeService();
    await expect(service.create(1, PM, 'EMPLOYEE', body({ tasks: [{ name: '  ' }] }) as any))
      .rejects.toThrow(/at least one task/);
  });

  it('refuses somebody from another company', async () => {
    const { service } = makeService({
      employee: { findMany: jest.fn().mockResolvedValue([{ id: 60 }, { id: 61 }]) },
    });
    await expect(service.create(1, PM, 'EMPLOYEE', body() as any))
      .rejects.toThrow(/not an employee of this company/);
  });

  it('stores the days as UTC midnight, so a date is one row wherever it is read', async () => {
    const { service, prisma } = makeService();
    await service.create(1, PM, 'EMPLOYEE', body() as any);
    const { startDate, endDate } = prisma.fieldVisitRequest.create.mock.calls[0][0].data;
    expect(startDate.toISOString()).toBe('2026-09-22T00:00:00.000Z');
    expect(endDate.toISOString()).toBe('2026-09-24T00:00:00.000Z');
  });

  it('takes the next number up when two requests race for the same one', async () => {
    const { service, prisma } = makeService();
    const duplicate = Object.assign(new Error('unique'), {
      code: 'P2002', meta: { target: ['companyId', 'requestNumber'] },
    });
    prisma.fieldVisitRequest.create
      .mockRejectedValueOnce(duplicate)
      .mockImplementationOnce((a: any) => Promise.resolve({ id: 10, ...a.data }));

    const created = await service.create(1, PM, 'EMPLOYEE', body() as any);
    expect(created.requestNumber).toBe('FVR-0008');
  });
});

describe('deciding', () => {
  it('lets an administrator approve, and tells everyone going', async () => {
    const { service, prisma, notifications } = makeService();
    const approved = await service.approve(1, ADMIN_EMP, 'ADMIN', 9);

    expect(approved.status).toBe(FIELD_VISIT_STATUS.APPROVED);
    expect(prisma.fieldVisitRequest.update.mock.calls[0][0].data.reviewedById).toBe(ADMIN_EMP);
    expect(actions(prisma)).toEqual(['APPROVED']);
    expect(notifications.notifyEmployees).toHaveBeenCalledWith(
      [PM, ...MEMBERS],
      expect.objectContaining({ title: 'Field visit approved' }),
    );
  });

  it('assigns the tasks and the schedule in the same write as the decision', async () => {
    const { service, prisma, activation, notifications } = makeService();
    await service.approve(1, ADMIN_EMP, 'ADMIN', 9);

    // Inside the transaction, with the transaction's own client — an approval
    // whose fan-out is not part of the same write can commit a trip nobody
    // was actually assigned to.
    expect(activation.activate).toHaveBeenCalledWith(prisma, expect.objectContaining({ id: 9 }), ADMIN_EMP);
    expect(prisma.fieldVisitRequestActivity.create.mock.calls[0][0].data.detail)
      .toContain('12 task(s) assigned, 9 attendance day(s) scheduled');
    expect(notifications.notifyEmployees.mock.calls[0][1].message)
      .toContain('12 task(s) are on your board');
  });

  it('does not fan out when the decision is a rejection', async () => {
    const { service, activation } = makeService();
    await service.reject(1, ADMIN_EMP, 'ADMIN', 9, 'Client postponed');
    expect(activation.activate).not.toHaveBeenCalled();
  });

  it('refuses a project manager who is not an administrator', async () => {
    const { service } = makeService();
    await expect(service.approve(1, PM, 'EMPLOYEE', 9))
      .rejects.toThrow(/Only an administrator/);
  });

  it('refuses an administrator approving the trip they raised themselves', async () => {
    const { service } = makeService({
      fieldVisitRequest: {
        ...makeService().prisma.fieldVisitRequest,
        findFirst: jest.fn().mockResolvedValue({ ...PENDING_REQUEST, raisedById: ADMIN_EMP }),
      },
    });
    await expect(service.approve(1, ADMIN_EMP, 'ADMIN', 9))
      .rejects.toThrow(/cannot approve your own/);
  });

  it('refuses to decide a request that is still a draft', async () => {
    const { service } = makeService({
      fieldVisitRequest: {
        ...makeService().prisma.fieldVisitRequest,
        findFirst: jest.fn().mockResolvedValue({ ...PENDING_REQUEST, status: FIELD_VISIT_STATUS.DRAFT }),
      },
    });
    await expect(service.approve(1, ADMIN_EMP, 'ADMIN', 9))
      .rejects.toThrow(/nothing to decide/);
  });

  it('will not reject without a reason — the reason is what the manager acts on', async () => {
    const { service } = makeService();
    await expect(service.reject(1, ADMIN_EMP, 'ADMIN', 9, '   '))
      .rejects.toThrow(/reason is required/);
  });

  it('records the rejection reason and tells only the manager', async () => {
    const { service, prisma, notifications } = makeService();
    const rejected = await service.reject(1, ADMIN_EMP, 'ADMIN', 9, 'Client postponed');

    expect(rejected.status).toBe(FIELD_VISIT_STATUS.REJECTED);
    expect(rejected.rejectionReason).toBe('Client postponed');
    expect(prisma.fieldVisitRequestActivity.create.mock.calls[0][0].data.detail)
      .toBe('Client postponed');
    expect(notifications.notifyEmployees).toHaveBeenCalledWith(
      [PM], expect.objectContaining({ title: 'Field visit rejected' }),
    );
  });

  it('warns when a submission reaches nobody who can approve it', async () => {
    const { service, notifications } = makeService({
      fieldVisitRequest: {
        ...makeService().prisma.fieldVisitRequest,
        findFirst: jest.fn().mockResolvedValue({ ...PENDING_REQUEST, status: FIELD_VISIT_STATUS.DRAFT }),
      },
    });
    notifications.notifyApprovers.mockResolvedValue(0);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await service.submit(1, PM, 'EMPLOYEE', 9);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reached no approver'));
  });
});

describe('editing and calling off', () => {
  it('refuses to edit once it is with an approver', async () => {
    const { service } = makeService();
    await expect(service.update(1, PM, 'EMPLOYEE', 9, body() as any))
      .rejects.toThrow(/withdraw it to a draft/);
  });

  it('records what actually changed on a draft', async () => {
    const draft = {
      ...PENDING_REQUEST, status: FIELD_VISIT_STATUS.DRAFT,
      projectId: 3, latitude: 28.6139, longitude: 77.209,
      startTime: '09:00', endTime: '18:00',
      members: MEMBERS.map((employeeId) => ({ employeeId })),
      tasks: [{ name: 'Site Inspection' }, { name: 'Network Configuration' }],
    };
    const { service, prisma } = makeService({
      fieldVisitRequest: {
        ...makeService().prisma.fieldVisitRequest,
        findFirst: jest.fn().mockResolvedValue(draft),
      },
    });

    await service.update(1, PM, 'EMPLOYEE', 9, body({
      location: 'Client Site – Gurgaon',
      employeeIds: [60, 61],
    }) as any);

    expect(prisma.fieldVisitRequestActivity.create.mock.calls[0][0].data)
      .toMatchObject({ action: 'UPDATED', detail: 'site, people' });
  });

  it('lets the manager call off an approved trip, and tells the people on it', async () => {
    const { service, prisma, notifications } = makeService({
      fieldVisitRequest: {
        ...makeService().prisma.fieldVisitRequest,
        findFirst: jest.fn().mockResolvedValue({ ...PENDING_REQUEST, status: FIELD_VISIT_STATUS.APPROVED }),
      },
    });

    const cancelled = await service.cancel(1, PM, 'EMPLOYEE', 9, 'Client postponed');
    expect(cancelled.status).toBe(FIELD_VISIT_STATUS.CANCELLED);
    expect(prisma.fieldVisitRequestActivity.create.mock.calls[0][0].data)
      .toMatchObject({ action: 'CANCELLED', oldValue: 'APPROVED', newValue: 'CANCELLED' });
    expect(notifications.notifyEmployees).toHaveBeenCalledWith(
      [PM, ...MEMBERS], expect.objectContaining({ title: 'Field visit cancelled' }),
    );
  });

  it('gives the days back when an approved trip is called off', async () => {
    const { service, prisma, activation } = makeService({
      fieldVisitRequest: {
        ...makeService().prisma.fieldVisitRequest,
        findFirst: jest.fn().mockResolvedValue({ ...PENDING_REQUEST, status: FIELD_VISIT_STATUS.APPROVED }),
      },
    });

    await service.cancel(1, PM, 'EMPLOYEE', 9, 'Client postponed');
    expect(activation.deactivate).toHaveBeenCalledWith(prisma, expect.objectContaining({ id: 9 }), PM);
    expect(prisma.fieldVisitRequestActivity.create.mock.calls[0][0].data.detail)
      .toBe('Client postponed — 12 task(s) archived, 9 unclocked day(s) released');
  });

  it('has nothing to give back when a draft is called off', async () => {
    const { service, activation } = makeService({
      fieldVisitRequest: {
        ...makeService().prisma.fieldVisitRequest,
        findFirst: jest.fn().mockResolvedValue({ ...PENDING_REQUEST, status: FIELD_VISIT_STATUS.DRAFT }),
      },
    });
    await service.cancel(1, PM, 'EMPLOYEE', 9);
    expect(activation.deactivate).not.toHaveBeenCalled();
  });

  it('refuses a stranger calling off a trip that is not theirs', async () => {
    const { service } = makeService();
    await expect(service.cancel(1, 60, 'EMPLOYEE', 9))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('who can see what', () => {
  it('scopes a plain employee to their own trips and the ones they are on', async () => {
    const { service, prisma } = makeService();
    await service.list(1, 'EMPLOYEE', 60, {});
    const where = prisma.fieldVisitRequest.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { raisedById: 60 },
      { members: { some: { employeeId: 60 } } },
      { project: { leadId: 60 } },
      { project: { members: { some: { employeeId: 60, role: 'PROJECT_MANAGER' } } } },
    ]);
  });

  it('lets an administrator see the whole company', async () => {
    const { service, prisma } = makeService();
    await service.list(1, 'ADMIN', ADMIN_EMP, {});
    expect(prisma.fieldVisitRequest.findMany.mock.calls[0][0].where).toEqual({ companyId: 1 });
  });

  it('hides a request the caller may not see behind a not-found', async () => {
    const { service } = makeService({
      fieldVisitRequest: {
        ...makeService().prisma.fieldVisitRequest,
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(service.getOne(1, 'EMPLOYEE', 60, 9))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
