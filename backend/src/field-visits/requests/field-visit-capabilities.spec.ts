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
      count: jest.fn().mockResolvedValue(0),
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

/**
 * 15 Oct 2026: an employee (not a project manager) could raise a General visit,
 * because general visits skipped the manager check. Employees go on visits and
 * clock in; raising them is for project managers and administrators.
 */
describe('who may raise a field visit', () => {
  const general = { id: 1, isSystem: true, isGeneral: true, leadId: null, members: [] };
  const mayRaise = (service: any, role: string, employeeId: number, project: any = general) =>
    service.mayRaise(1, project, role, employeeId);

  it('refuses a general visit to an employee who manages no project', async () => {
    const { service } = make();
    expect(await mayRaise(service, 'EMPLOYEE', 60)).toBe(false);
  });

  it('lets a project manager raise a general visit', async () => {
    const { service, prisma } = make();
    prisma.project.count.mockResolvedValue(1);
    expect(await mayRaise(service, 'EMPLOYEE', 50)).toBe(true);
    expect(prisma.project.count.mock.calls[0][0].where).toMatchObject({ companyId: 1, isSystem: false });
  });

  it('lets an administrator raise anything', async () => {
    const { service } = make();
    expect(await mayRaise(service, 'ADMIN', 2)).toBe(true);
    expect(await mayRaise(service, 'SUPERADMIN', 2)).toBe(true);
  });

  it('says canRaise is false for someone who manages nothing', async () => {
    const { service } = make({ project: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() } });
    expect(await service.capabilities(1, 'EMPLOYEE', 60)).toMatchObject({ canRaise: false });
  });
});
