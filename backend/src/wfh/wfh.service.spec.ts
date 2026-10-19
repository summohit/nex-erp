import { WfhService } from './wfh.service';

/** WFH requests (19 Oct 2026): manager then HR, super admin settles, monthly limit. */
function setup(over: any = {}) {
  const rows: any[] = [];
  const prisma: any = {
    systemSetting: { findUnique: jest.fn(async () => ({ wfhDaysPerMonth: 1 })) },
    employee: {
      findUnique: jest.fn(async () => ({ managerId: 2, firstName: 'A', lastName: 'B' })),
      findMany: jest.fn(async () => [{ id: 9 }]),
      count: jest.fn(async () => 0),
    },
    wfhRequest: {
      findFirst: jest.fn(async () => over.existing ?? null),
      count: jest.fn(async () => over.used ?? 0),
      create: jest.fn(async ({ data }: any) => { rows.push(data); return { id: 1, ...data }; }),
      update: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
    },
  };
  const notifications: any = { notifyEmployees: jest.fn(async () => 1) };
  return { svc: new WfhService(prisma, notifications), prisma, rows };
}
const future = () => new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

describe('WFH requests', () => {
  it('goes to the reporting manager first', async () => {
    const { svc, rows } = setup();
    await svc.create({ companyId: 1, role: 'EMPLOYEE', employeeId: 5 }, { date: future(), reason: 'plumber' });
    expect(rows[0].status).toBe('PENDING_MANAGER');
  });

  it('refuses a second day when the monthly limit is used', async () => {
    const { svc } = setup({ used: 1 });
    await expect(svc.create({ companyId: 1, role: 'EMPLOYEE', employeeId: 5 }, { date: future(), reason: 'x' }))
      .rejects.toThrow(/used your 1 WFH day/);
  });

  it('manager approval moves it to HR', async () => {
    const { svc, prisma } = setup({ existing: { id: 1, employeeId: 5, status: 'PENDING_MANAGER', date: new Date(), employee: { id: 5, managerId: 2 } } });
    await svc.review({ companyId: 1, role: 'EMPLOYEE', employeeId: 2 }, 1, { action: 'APPROVE' });
    expect(prisma.wfhRequest.update.mock.calls[0][0].data.status).toBe('PENDING_HR');
  });

  it('the super admin settles it at any stage, also as the manager', async () => {
    const { svc, prisma } = setup({ existing: { id: 1, employeeId: 5, status: 'PENDING_MANAGER', date: new Date(), employee: { id: 5, managerId: 2 } } });
    await svc.review({ companyId: 1, role: 'SUPERADMIN', employeeId: 2 }, 1, { action: 'APPROVE' });
    expect(prisma.wfhRequest.update.mock.calls[0][0].data.status).toBe('APPROVED');
  });

  it('HR cannot skip the manager step', async () => {
    const { svc } = setup({ existing: { id: 1, employeeId: 5, status: 'PENDING_MANAGER', date: new Date(), employee: { id: 5, managerId: 2 } } });
    await expect(svc.review({ companyId: 1, role: 'HR', employeeId: 7 }, 1, { action: 'APPROVE' })).rejects.toThrow(/reporting manager/);
  });

  it('nobody decides their own request', async () => {
    const { svc } = setup({ existing: { id: 1, employeeId: 5, status: 'PENDING_HR', date: new Date(), employee: { id: 5, managerId: 2 } } });
    await expect(svc.review({ companyId: 1, role: 'SUPERADMIN', employeeId: 5 }, 1, { action: 'APPROVE' })).rejects.toThrow(/own request/);
  });
});
