import { LeavesService } from './leaves.service';

/**
 * The quota report.
 *
 * The two things worth pinning: a non-admin can never widen their own scope by
 * passing someone else's employeeId, and an employee with no balance rows still
 * appears — a report that silently omits people hides exactly the gap somebody
 * needs to fix.
 */
describe('LeavesService.getQuotaReport', () => {
  const COMPANY = 1;
  const YEAR = 2026;

  let prisma: any;
  let service: LeavesService;
  let types: any[];
  let employees: any[];
  let balances: any[];
  let encashments: any[];

  beforeEach(() => {
    types = [
      { id: 1, name: 'Casual Leave', isPaid: true, encashable: false, encashmentLimit: 0 },
      { id: 2, name: 'Privilege Leave', isPaid: true, encashable: true, encashmentLimit: 30 },
    ];
    employees = [
      { id: 10, firstName: 'Akshara', lastName: 'Shukla', employeeCode: 'E10', avatarUrl: null,
        designation: { name: 'HR Associate' }, department: { name: 'HR' }, user: { status: 'ACTIVE' } },
      { id: 11, firstName: 'Zara', lastName: 'Khan', employeeCode: 'E11', avatarUrl: null,
        designation: null, department: null, user: { status: 'SUSPENDED' } },
    ];
    balances = [
      { employeeId: 10, leaveTypeId: 1, allocated: 10, used: 4 },
      { employeeId: 10, leaveTypeId: 2, allocated: 15, used: 2 },
    ];
    // Privilege Leave closed out: 13 days were left and got paid.
    encashments = [{ employeeId: 10, leaveTypeId: 2, days: 13 }];

    prisma = {
      leaveType: { findMany: jest.fn(async () => types) },
      employee: {
        findMany: jest.fn(async ({ where }: any) =>
          employees.filter((e) => (where.id ? e.id === where.id : true)),
        ),
        findUnique: jest.fn(async () => ({ id: 10 })),
      },
      leaveBalance: {
        findMany: jest.fn(async ({ where }: any) =>
          balances.filter((b) => {
            const scoped = where.employee?.id;
            return (!scoped || b.employeeId === scoped) && where.year === YEAR;
          }),
        ),
      },
      leaveEncashment: {
        findMany: jest.fn(async ({ where }: any) =>
          encashments.filter((e) => {
            const scoped = where.employee?.id;
            return (!scoped || e.employeeId === scoped) && where.year === YEAR;
          }),
        ),
      },
    };
    service = new LeavesService(prisma, {} as any);
  });

  const asAdmin = (employeeId?: number) =>
    service.getQuotaReport(COMPANY, { sub: 1, role: 'ADMIN' }, YEAR, employeeId);

  it('totals allocated − used per employee, with nothing inherited from last year', async () => {
    const res = await asAdmin();
    const row = res.rows.find((r) => r.employee.id === 10)!;

    expect(row.totals).toEqual({ allocated: 25, used: 6, remaining: 19, encashed: 13 });
  });

  it('breaks the figures down per leave type', async () => {
    const res = await asAdmin();
    const row = res.rows.find((r) => r.employee.id === 10)!;

    expect(row.byType[1]).toEqual({ allocated: 10, used: 4, remaining: 6, encashed: 0 });
    expect(row.byType[2]).toEqual({ allocated: 15, used: 2, remaining: 13, encashed: 13 });
  });

  it('includes an employee with no balance rows, and flags it', async () => {
    const res = await asAdmin();
    const row = res.rows.find((r) => r.employee.id === 11)!;

    expect(row).toBeDefined();
    expect(row.hasNoBalances).toBe(true);
    expect(row.totals.allocated).toBe(0);
    // Every type still gets a cell, so the columns line up across rows.
    expect(Object.keys(row.byType)).toHaveLength(types.length);
  });

  it('sinks deactivated staff to the bottom without hiding them', async () => {
    const res = await asAdmin();
    expect(res.rows.map((r) => r.employee.id)).toEqual([10, 11]);
    expect(res.rows[1].employee.isActive).toBe(false);
  });

  it('sends each leave type once rather than on every row', async () => {
    const res = await asAdmin();
    expect(res.leaveTypes).toHaveLength(2);
    // Rows carry ids, not copies — this company has been throttled for egress.
    expect(JSON.stringify(res.rows)).not.toContain('Privilege Leave');
  });

  // The access rule. A non-admin passing someone else's id must not widen scope.
  it('scopes a non-admin to themselves even when they ask for someone else', async () => {
    const res = await service.getQuotaReport(COMPANY, { sub: 99, role: 'EMPLOYEE' }, YEAR, 11);

    expect(res.scope).toBe('SELF');
    expect(prisma.employee.findUnique).toHaveBeenCalled();
    // findUnique is stubbed to return employee 10 — their own row, not 11.
    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 10 }) }),
    );
  });

  it('lets an admin filter to one employee', async () => {
    const res = await asAdmin(10);
    expect(res.scope).toBe('ALL');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].employee.id).toBe(10);
  });

  // Encashed days are reported beside the remaining ones, never folded into
  // `used` — an employee who took no leave and was paid for it must not read as
  // having taken all of it.
  it('keeps encashed days out of the used figure', async () => {
    const res = await asAdmin();
    const cell = res.rows.find((r) => r.employee.id === 10)!.byType[2];

    expect(cell.used).toBe(2);
    expect(cell.encashed).toBe(13);
  });

  it('reports whether the year has been settled yet', async () => {
    await expect(asAdmin()).resolves.toMatchObject({ encashmentSettled: true });

    encashments = [];
    await expect(asAdmin()).resolves.toMatchObject({ encashmentSettled: false });
  });
});
