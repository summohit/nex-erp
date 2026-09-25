import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FieldVisitRequestsService } from './field-visit-requests.service';
import { FieldVisitActivationService } from './field-visit-activation.service';
import { FIELD_VISIT_STATUS } from '../field-visit-status';

/**
 * §10: an approved field visit is changed by asking, not by editing.
 *
 * The property that matters most is that the proposal is *held*. People are at
 * the site clocking against the coordinates and the radius on the request row,
 * so a proposed change written straight into it would move the geofence under
 * them before anybody approved it.
 */

const PM = 71;
const ADMIN = 90;

const PROJECT = {
  id: 3, name: 'Acme Rollout', key: 'ACME', leadId: 70,
  members: [{ employeeId: 71, role: 'PROJECT_MANAGER' }],
};

const APPROVED = {
  id: 9, requestNumber: 'FVR-0009', status: FIELD_VISIT_STATUS.APPROVED,
  raisedById: PM, companyId: 1, projectId: 3,
  location: 'Client Site – Delhi', latitude: 28.6139, longitude: 77.209,
  startDate: new Date('2026-09-22T00:00:00.000Z'),
  endDate: new Date('2026-09-24T00:00:00.000Z'),
  visitDays: 3, startTime: '09:00', endTime: '18:00',
  pendingChange: null,
  project: { id: 3, name: 'Acme Rollout' },
  members: [{ employeeId: 60 }, { employeeId: 61 }],
  tasks: [
    { id: 1, name: 'Site Inspection', description: null, position: 0 },
    { id: 2, name: 'Network Configuration', description: null, position: 1 },
  ],
};

/** The same trip, with one person swapped out. */
function change(over: any = {}) {
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
    employeeIds: [60, 62],
    tasks: [{ name: 'Site Inspection' }, { name: 'Network Configuration' }],
    ...over,
  };
}

function makeService(requestOver: any = {}) {
  const request = { ...APPROVED, ...requestOver };
  const saved = {
    ...request,
    members: [{ id: 1, employee: { id: 60 } }, { id: 2, employee: { id: 62 } }],
    tasks: request.tasks,
    raisedBy: { id: PM, firstName: 'Priya', lastName: 'Menon' },
  };

  const prisma: any = {
    // Echoes the id it was asked for, the way a real lookup does — the
    // "cannot move to another project" rule is a comparison against it.
    project: {
      findFirst: jest.fn().mockImplementation((a: any) =>
        Promise.resolve({ ...PROJECT, id: a.where.id })),
    },
    employee: {
      findMany: jest.fn().mockImplementation((a: any) =>
        Promise.resolve((a.where.id.in as number[]).map((id) => ({ id })))),
    },
    fieldVisitRequest: {
      findFirst: jest.fn().mockResolvedValue(request),
      // Prisma returns what `select` asked for, so a nested `create` comes
      // back as the resulting rows — not as the write instruction. A mock that
      // echoes `data` verbatim hands the code a shape it never sees in life.
      update: jest.fn().mockImplementation((a: any) => {
        const { members, tasks, ...scalars } = a.data;
        return Promise.resolve({
          ...saved,
          ...scalars,
          members: members?.create
            ? members.create.map((m: any, i: number) => ({ id: i + 1, employee: { id: m.employeeId } }))
            : saved.members,
          tasks: tasks?.create
            ? tasks.create.map((t: any, i: number) => ({ id: i + 1, ...t }))
            : saved.tasks,
        });
      }),
    },
    fieldVisitRequestMember: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    fieldVisitRequestTask: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    fieldVisitRequestActivity: {
      create: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
    },
  };
  prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));

  const notifications: any = {
    notifyEmployees: jest.fn().mockResolvedValue(1),
    notifyApprovers: jest.fn().mockResolvedValue(1),
  };
  const activation: any = {
    reconcile: jest.fn().mockResolvedValue({
      issues: 2, attendanceDays: 3, rosterEntries: 6,
      releasedDays: 3, archivedTasks: 2,
    }),
  };
  return {
    service: new FieldVisitRequestsService(prisma, notifications, activation),
    prisma, notifications, activation,
  };
}

describe('proposing a change', () => {
  it('stores the proposal without touching the trip people are clocking against', async () => {
    const { service, prisma } = makeService();
    await service.requestModification(1, PM, 'EMPLOYEE', 9, change() as any);

    const written = prisma.fieldVisitRequest.update.mock.calls[0][0].data;
    // The proposal, and only the proposal.
    expect(Object.keys(written).sort()).toEqual(['pendingChange', 'pendingChangeAt']);
    expect(written.pendingChange).toMatchObject({
      location: 'Client Site – Delhi',
      employeeIds: [60, 62],
    });
  });

  it('records what it would change, and puts it in an approver queue', async () => {
    const { service, prisma, notifications } = makeService();
    await service.requestModification(1, PM, 'EMPLOYEE', 9, change() as any);

    expect(prisma.fieldVisitRequestActivity.create.mock.calls[0][0].data)
      .toMatchObject({ action: 'MODIFICATION_REQUESTED', detail: 'Proposed changes to people' });
    expect(notifications.notifyApprovers).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ACTION_REQUIRED' }),
    );
  });

  it('refuses a change that changes nothing', async () => {
    const { service } = makeService();
    await expect(service.requestModification(1, PM, 'EMPLOYEE', 9, change({ employeeIds: [60, 61] }) as any))
      .rejects.toThrow(/Nothing in this request would change/);
  });

  it('refuses a second proposal while one is waiting', async () => {
    const { service } = makeService({ pendingChange: { location: 'Somewhere else' } });
    await expect(service.requestModification(1, PM, 'EMPLOYEE', 9, change() as any))
      .rejects.toThrow(/already a change waiting/);
  });

  it('refuses this route for a trip nobody has approved yet', async () => {
    const { service } = makeService({ status: FIELD_VISIT_STATUS.DRAFT });
    await expect(service.requestModification(1, PM, 'EMPLOYEE', 9, change() as any))
      .rejects.toThrow(/Only an approved field visit is changed this way/);
  });

  it('refuses to move a trip onto another project', async () => {
    const { service } = makeService();
    await expect(service.requestModification(1, PM, 'EMPLOYEE', 9, change({ projectId: 4 }) as any))
      .rejects.toThrow(/cannot be moved to another project/);
  });

  it('refuses somebody who does not run the project', async () => {
    const { service } = makeService();
    await expect(service.requestModification(1, 60, 'EMPLOYEE', 9, change() as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still applies the ordinary validation to the proposal', async () => {
    const { service } = makeService();
    // 22nd to 24th is three days, whatever the form believes.
    await expect(service.requestModification(1, PM, 'EMPLOYEE', 9, change({ visitDays: 2 }) as any))
      .rejects.toThrow(/is 3 day\(s\), not 2/);
  });
});

describe('ruling on the change', () => {
  const WITH_CHANGE = {
    pendingChange: {
      projectId: 3,
      location: 'Client Site – Gurgaon',
      latitude: 28.4595, longitude: 77.0266,
      startDate: '2026-09-22T00:00:00.000Z',
      endDate: '2026-09-23T00:00:00.000Z',
      visitDays: 2, startTime: '09:00', endTime: '18:00', remarks: null,
      employeeIds: [60, 62],
      tasks: [{ name: 'Site Inspection', description: null, position: 0 }],
    },
  };

  it('applies it and makes the work match, in one write', async () => {
    const { service, prisma, activation } = makeService(WITH_CHANGE);
    await service.approveModification(1, ADMIN, 'ADMIN', 9);

    const written = prisma.fieldVisitRequest.update.mock.calls[0][0].data;
    expect(written.location).toBe('Client Site – Gurgaon');
    expect(written.visitDays).toBe(2);
    expect(written.pendingChange).toBe(Prisma.DbNull);
    // Members and tasks are replaced, not merged.
    expect(prisma.fieldVisitRequestMember.deleteMany).toHaveBeenCalledWith({ where: { requestId: 9 } });
    expect(activation.reconcile).toHaveBeenCalledWith(
      prisma, expect.objectContaining({ id: 9 }), ADMIN,
    );
  });

  it('records what the reconciliation actually did', async () => {
    const { service, prisma } = makeService(WITH_CHANGE);
    await service.approveModification(1, ADMIN, 'ADMIN', 9);

    expect(prisma.fieldVisitRequestActivity.create.mock.calls[0][0].data.detail)
      .toBe('2 task(s) assigned, 3 day(s) scheduled, 2 task(s) archived, 3 day(s) released');
  });

  it('tells everybody still on the trip', async () => {
    const { service, notifications } = makeService(WITH_CHANGE);
    await service.approveModification(1, ADMIN, 'ADMIN', 9);

    expect(notifications.notifyEmployees).toHaveBeenCalledWith(
      [PM, 60, 62],
      expect.objectContaining({ title: 'Field visit changed' }),
    );
  });

  it('leaves the trip exactly as approved when the change is turned down', async () => {
    const { service, prisma, activation } = makeService(WITH_CHANGE);
    await service.rejectModification(1, ADMIN, 'ADMIN', 9, 'Client will not have access');

    const written = prisma.fieldVisitRequest.update.mock.calls[0][0].data;
    expect(Object.keys(written).sort()).toEqual(['pendingChange', 'pendingChangeAt']);
    expect(written.pendingChange).toBe(Prisma.DbNull);
    expect(activation.reconcile).not.toHaveBeenCalled();
  });

  it('will not turn one down without a reason', async () => {
    const { service } = makeService(WITH_CHANGE);
    await expect(service.rejectModification(1, ADMIN, 'ADMIN', 9, '  '))
      .rejects.toThrow(/reason is required/);
  });

  it('refuses a project manager ruling on their own change', async () => {
    const { service } = makeService(WITH_CHANGE);
    await expect(service.approveModification(1, PM, 'EMPLOYEE', 9))
      .rejects.toThrow(/Only an administrator rules on a change/);
  });

  it('refuses when there is no change waiting', async () => {
    const { service } = makeService();
    await expect(service.approveModification(1, ADMIN, 'ADMIN', 9))
      .rejects.toThrow(/no change waiting/);
  });
});

describe('withdrawing a submitted request', () => {
  it('puts it back to a draft, which is what editing it asks for', async () => {
    const { service, prisma } = makeService({ status: FIELD_VISIT_STATUS.PENDING });
    await service.withdraw(1, PM, 'EMPLOYEE', 9);

    expect(prisma.fieldVisitRequest.update.mock.calls[0][0].data)
      .toEqual({ status: FIELD_VISIT_STATUS.DRAFT, submittedAt: null });
    expect(prisma.fieldVisitRequestActivity.create.mock.calls[0][0].data)
      .toMatchObject({ action: 'WITHDRAWN', oldValue: 'PENDING_APPROVAL', newValue: 'DRAFT' });
  });

  it('refuses to withdraw an approved trip — that is a change request', async () => {
    const { service } = makeService();
    await expect(service.withdraw(1, PM, 'EMPLOYEE', 9))
      .rejects.toThrow(/nothing to withdraw/);
  });

  it('refuses a bystander', async () => {
    const { service } = makeService({ status: FIELD_VISIT_STATUS.PENDING });
    await expect(service.withdraw(1, 60, 'EMPLOYEE', 9))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
