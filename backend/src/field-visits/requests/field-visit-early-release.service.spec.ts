import { FieldVisitEarlyReleaseService } from './field-visit-early-release.service';

/** Field visit early release (21 Oct 2026). */
function setup(over: any = {}) {
  const future = new Date(Date.now() + 2 * 86400000);
  const d0 = new Date(Date.UTC(future.getUTCFullYear(), future.getUTCMonth(), future.getUTCDate()));
  const d1 = new Date(d0.getTime() + 86400000);
  const prisma: any = {
    fieldVisitAttendance: {
      findMany: jest.fn(async () => over.days ?? [{ visitDate: d0, status: 'SCHEDULED' }, { visitDate: d1, status: 'SCHEDULED' }]),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    fieldVisitEarlyRelease: {
      findFirst: jest.fn(async () => over.existing ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
    },
    employee: { findUnique: jest.fn(async () => ({ firstName: 'A', lastName: 'B' })) },
    fieldVisitRequest: {
      findUnique: jest.fn(async () => ({ requestNumber: 'FV-1', project: { id: 3, leadId: 9, members: [{ employeeId: 8 }] } })),
    },
    attendance: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const clock: any = { completeIfNothingLeft: jest.fn(async () => undefined) };
  const svc = new FieldVisitEarlyReleaseService(prisma, { notifyEmployees: jest.fn(async () => 1) } as any, clock);
  return { svc, prisma, clock, d0, d1 };
}
const key = (d: Date) => d.toISOString().slice(0, 10);

describe('field visit early release', () => {
  it('asks for a DAYS release when later visit days exist', async () => {
    const { svc, prisma, d0 } = setup();
    await svc.create({ companyId: 1, role: 'EMPLOYEE', employeeId: 5 }, { requestId: 1, type: 'DAYS', date: key(d0), reason: 'done' });
    expect(prisma.fieldVisitEarlyRelease.create).toHaveBeenCalled();
  });

  it('refuses a DAYS release on the last visit day', async () => {
    const { svc, d1 } = setup();
    await expect(svc.create({ companyId: 1, role: 'EMPLOYEE', employeeId: 5 }, { requestId: 1, type: 'DAYS', date: key(d1), reason: 'done' }))
      .rejects.toThrow(/no visit days after/);
  });

  it('the project manager approves; DAYS releases the later days', async () => {
    const { svc, prisma, clock } = setup({ existing: { id: 1, requestId: 1, employeeId: 5, type: 'DAYS', date: new Date(), status: 'PENDING' } });
    await svc.review({ companyId: 1, role: 'EMPLOYEE', employeeId: 8 }, 1, { action: 'APPROVE' });
    expect(prisma.fieldVisitAttendance.updateMany.mock.calls[0][0].data.status).toBe('RELEASED');
    expect(clock.completeIfNothingLeft).toHaveBeenCalledWith(1);
  });

  it('HOURS approval turns an early clock-out back into a full day', async () => {
    const { svc, prisma } = setup({ existing: { id: 1, requestId: 1, employeeId: 5, type: 'HOURS', date: new Date(), status: 'PENDING' } });
    await svc.review({ companyId: 1, role: 'SUPERADMIN', employeeId: 2 }, 1, { action: 'APPROVE' });
    expect(prisma.attendance.updateMany.mock.calls[0][0].data).toEqual({ isEarlyLeave: false, status: 'PRESENT' });
  });

  it('someone who is not the PM or super admin cannot decide', async () => {
    const { svc } = setup({ existing: { id: 1, requestId: 1, employeeId: 5, type: 'HOURS', date: new Date(), status: 'PENDING' } });
    await expect(svc.review({ companyId: 1, role: 'HR', employeeId: 7 }, 1, { action: 'APPROVE' })).rejects.toThrow(/project's manager/);
  });
});
