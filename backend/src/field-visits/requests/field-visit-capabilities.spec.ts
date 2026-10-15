import { FieldVisitRequestsService } from './field-visit-requests.service';

/**
 * The mobile app showed "New request", "Withdraw" and "Cancel" to everybody and
 * let the server refuse. These tell a client what the server would allow.
 */
function make(over: any = {}) {
  const prisma: any = {
    project: {
      findMany: jest.fn().mockResolvedValue([{ id: 7 }, { id: 9 }]),
      findFirst: jest.fn().mockResolvedValue({ id: 7, leadId: 50, isSystem: false, isGeneral: false, members: [] }),
    },
    fieldVisitRequest: { findFirst: jest.fn() },
    ...over,
  };
  return { service: new FieldVisitRequestsService(prisma, {} as any, {} as any), prisma };
}

describe('field visit capabilities', () => {
  it('lists the projects a project manager runs', async () => {
    const { service, prisma } = make();
    const caps = await service.capabilities(1, 'EMPLOYEE', 50);
    expect(caps).toMatchObject({ isApprover: false, allProjects: false, managedProjectIds: [7, 9], isProjectManager: true });
    const where = prisma.project.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ companyId: 1, isSystem: false });
    expect(where.OR).toEqual([
      { leadId: 50 },
      { members: { some: { employeeId: 50, role: 'PROJECT_MANAGER' } } },
    ]);
  });

  it('gives an employee who manages nothing no project visits', async () => {
    const { service } = make({ project: { findMany: jest.fn().mockResolvedValue([]) } });
    expect(await service.capabilities(1, 'EMPLOYEE', 60)).toMatchObject({ isProjectManager: false, managedProjectIds: [] });
  });

  it('lets an administrator raise on every project without a lookup', async () => {
    const { service, prisma } = make();
    expect(await service.capabilities(1, 'ADMIN', 2)).toMatchObject({ isApprover: true, isSuperAdmin: false, allProjects: true });
    expect(await service.capabilities(1, 'SUPERADMIN', 2)).toMatchObject({ isSuperAdmin: true });
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });
});

describe('per-request actions', () => {
  const request = (status: string) => ({
    id: 3, status, pendingChange: null, raisedBy: { id: 50 },
    project: { id: 7, isSystem: false },
  });

  async function flags(role: string, status: string, employeeId = 60) {
    const { service, prisma } = make();
    prisma.fieldVisitRequest.findFirst.mockResolvedValue(request(status));
    return service.getOne(1, role, employeeId, 3);
  }

  it('offers cancel and complete only to administrators', async () => {
    expect(await flags('EMPLOYEE', 'APPROVED')).toMatchObject({ canCancel: false, canComplete: false });
    expect(await flags('ADMIN', 'APPROVED')).toMatchObject({ canCancel: true, canComplete: true });
  });

  it('offers nothing to cancel or complete on a finished trip', async () => {
    expect(await flags('ADMIN', 'COMPLETED')).toMatchObject({ canCancel: false, canComplete: false });
    expect(await flags('ADMIN', 'PENDING_APPROVAL')).toMatchObject({ canCancel: true, canComplete: false });
  });

  it('lets only the raiser or an administrator withdraw', async () => {
    expect(await flags('EMPLOYEE', 'PENDING_APPROVAL', 60)).toMatchObject({ canWithdraw: false });
    expect(await flags('EMPLOYEE', 'PENDING_APPROVAL', 50)).toMatchObject({ canWithdraw: true });
  });
});
