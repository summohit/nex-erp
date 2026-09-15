import { PayrollService } from './payroll.service';

/**
 * Leave encashment on the year's closing payslip.
 *
 * Leave used to roll into the next year. It no longer does — a year's days
 * expire with the year — so the unused ones are bought back on the December
 * slip instead of quietly disappearing. That makes this a money path, and three
 * things have to hold:
 *
 *  - the payout is priced at the LOP daily rate, and must not inflate the rate
 *    its own days are priced at;
 *  - it must not push the month's gross past the ESI ceiling or the TDS
 *    threshold, which are tests on regular salary, not on everything paid; and
 *  - regenerating the draft must replace last run's figures, not add to them.
 */
describe('PayrollService — year-end leave encashment', () => {
  const COMPANY = 1;
  const EMPLOYEE = 7;
  /** 22 working days in December 2026 with Sunday off; 44,000 gross => 2,000/day. */
  const GROSS = 44000;

  let prisma: any;
  let service: PayrollService;
  let balances: any[];
  let items: any[];
  let encashments: any[];

  const balance = (o: Partial<any>) => ({
    leaveTypeId: 1,
    allocated: 0,
    used: 0,
    leaveType: { name: 'Earned Leave', encashmentLimit: 0 },
    ...o,
  });

  beforeEach(() => {
    balances = [];
    items = [];
    encashments = [];

    prisma = {
      payslip: {
        // Two callers: the guard at the top of generatePayslips wants the
        // existing drafts (none), and getPayslips at the bottom wants the
        // finished slips — returning [] to that one sends it straight back
        // into generatePayslips forever.
        findMany: jest.fn(async ({ include }: any) => (include ? [{ id: 100 }] : [])),
        upsert: jest.fn(async ({ create }: any) => ({ id: 100, ...create })),
      },
      payslipItem: {
        deleteMany: jest.fn(async () => { items = []; }),
        createMany: jest.fn(async ({ data }: any) => { items = data; return { count: data.length }; }),
      },
      leaveEncashment: {
        deleteMany: jest.fn(async () => { encashments = []; }),
        createMany: jest.fn(async ({ data }: any) => { encashments = data; return { count: data.length }; }),
      },
      leaveBalance: { findMany: jest.fn(async () => balances) },
      employee: {
        findMany: jest.fn(async () => [{
          id: EMPLOYEE,
          branch: { weeklyOffs: '0' }, // Sundays off
          salaryStructures: [
            { amount: GROSS, component: { name: 'Basic Salary', type: 'EARNING' } },
          ],
        }]),
      },
      // Present every day, so Loss of Pay is zero and the payout is the only
      // thing moving the slip. Built the same way the generator builds the
      // date it compares against, so the two agree on what day it is.
      attendance: {
        findMany: jest.fn(async () => Array.from({ length: 31 }, (_, i) => ({
          date: new Date(2026, 11, i + 1),
          status: 'PRESENT',
        }))),
      },
      leaveRequest: { findMany: jest.fn(async () => []) },
      expenseClaim: { findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 0 })) },
    };

    service = new PayrollService(prisma, {} as any, {} as any);
  });

  const run = (month: number, year = 2026) => service.generatePayslips(COMPANY, month, year);
  const encashmentItems = () => items.filter((i: any) => i.componentName.startsWith('Leave Encashment'));
  const dailyRate = () => {
    // Whatever the generator computed, derived the same way it does.
    const slip = prisma.payslip.upsert.mock.calls[0][0].create;
    return GROSS / slip.workingDays;
  };

  it('pays out the days left at the end of the year', async () => {
    balances = [balance({ allocated: 15, used: 3 })]; // 12 left
    await run(12);

    expect(encashmentItems()).toHaveLength(1);
    expect(encashmentItems()[0]).toMatchObject({
      type: 'EARNING',
      amount: Math.round(12 * dailyRate() * 100) / 100,
    });
    expect(encashmentItems()[0].componentName).toContain('Earned Leave');
    expect(encashmentItems()[0].componentName).toContain('12 days');
  });

  it('records what was paid, against the payslip that paid it', async () => {
    balances = [balance({ allocated: 15, used: 3 })];
    await run(12);

    expect(encashments).toHaveLength(1);
    expect(encashments[0]).toMatchObject({
      employeeId: EMPLOYEE, leaveTypeId: 1, year: 2026, days: 12, payslipId: 100, companyId: COMPANY,
    });
    expect(encashments[0].ratePerDay).toBeCloseTo(dailyRate(), 6);
  });

  it('does nothing in any other month', async () => {
    balances = [balance({ allocated: 15, used: 3 })];
    await run(11);

    expect(encashmentItems()).toHaveLength(0);
    expect(prisma.leaveBalance.findMany).not.toHaveBeenCalled();
  });

  it('caps the payout at the configured limit', async () => {
    balances = [balance({ allocated: 30, used: 0, leaveType: { name: 'Earned Leave', encashmentLimit: 5 } })];
    await run(12);

    expect(encashments[0].days).toBe(5);
  });

  // The field only appears once encashment is switched on, so a cap of zero
  // would make the switch do nothing at all.
  it('treats a limit of 0 as no cap', async () => {
    balances = [balance({ allocated: 30, used: 0 })];
    await run(12);

    expect(encashments[0].days).toBe(30);
  });

  it('pays nothing when the year was fully used', async () => {
    balances = [balance({ allocated: 10, used: 10 })];
    await run(12);

    expect(encashmentItems()).toHaveLength(0);
    expect(encashments).toHaveLength(0);
  });

  it('prices a day at what a day of absence costs', async () => {
    balances = [balance({ allocated: 1, used: 0 })];
    await run(12);

    const slip = prisma.payslip.upsert.mock.calls[0][0].create;
    // One unused day is worth exactly one day of LOP.
    expect(encashments[0].amount).toBeCloseTo(GROSS / slip.workingDays, 2);
  });

  // The payout is a one-off. Valuing its own days at an inflated rate, or
  // testing statutory thresholds against a gross it puffed up, would both be
  // wrong — and both are ordering bugs waiting to happen.
  it('does not inflate the daily rate or the statutory thresholds it is added after', async () => {
    balances = [balance({ allocated: 20, used: 0 })];
    await run(12);

    const slip = prisma.payslip.upsert.mock.calls[0][0].create;
    const payout = encashments[0].amount;

    // Priced off regular gross, not off gross + payout.
    expect(payout).toBeCloseTo(20 * (GROSS / slip.workingDays), 2);
    // TDS is 10% above 50,000. Regular gross is 44,000, so none is due even
    // though the payout takes the month well past the threshold.
    expect(slip.totalEarnings).toBeGreaterThan(50000);
    expect(items.some((i: any) => i.componentName.includes('TDS'))).toBe(false);
    // ...and the payout still reaches the employee.
    expect(slip.totalEarnings).toBeCloseTo(GROSS + payout, 2);
    expect(slip.netPay).toBeCloseTo(GROSS + payout - slip.totalDeductions, 2);
  });

  // A December draft gets regenerated after a late leave approval.
  it('replaces the previous run rather than paying twice', async () => {
    balances = [balance({ allocated: 15, used: 3 })];
    await run(12);
    const first = encashments[0].days;

    balances = [balance({ allocated: 15, used: 5 })]; // two more days approved late
    await run(12);

    expect(first).toBe(12);
    expect(encashments).toHaveLength(1);
    expect(encashments[0].days).toBe(10);
    expect(encashmentItems()).toHaveLength(1);
  });

  it('only looks at types flagged encashable', async () => {
    balances = [balance({ allocated: 15, used: 0 })];
    await run(12);

    expect(prisma.leaveBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ leaveType: { encashable: true } }),
      }),
    );
  });

  it('pays nothing to an employee with no salary structure', async () => {
    prisma.employee.findMany.mockResolvedValue([{
      id: EMPLOYEE, branch: { weeklyOffs: '0' }, salaryStructures: [],
    }]);
    balances = [balance({ allocated: 15, used: 0 })];
    await run(12);

    expect(encashments).toHaveLength(0);
  });

  // HR edits December's gross by hand. The salary lines absorb it; the payout
  // does not, because it is a recorded figure — so many days at so much a day —
  // and rescaling it would leave the slip disagreeing with the record behind it.
  describe('when the December total is adjusted by hand', () => {
    let stored: any[];

    beforeEach(() => {
      stored = [
        { id: 1, componentName: 'Basic Salary', type: 'EARNING', amount: 44000 },
        { id: 2, componentName: 'Leave Encashment — Earned Leave (12 days, 2026)', type: 'EARNING', amount: 24000 },
      ];
      prisma.payslip.findFirst = jest.fn(async () => ({
        id: 100, lossOfPay: 0, totalEarnings: 68000, totalDeductions: 5480, expenseAmount: 0, status: 'DRAFT',
      }));
      prisma.payslip.update = jest.fn(async ({ data }: any) => data);
      prisma.payslipItem.findMany = jest.fn(async ({ where }: any) =>
        stored.filter((i) => i.type === where.type),
      );
      prisma.payslipItem.update = jest.fn(async ({ where, data }: any) => {
        const item = stored.find((i) => i.id === where.id)!;
        Object.assign(item, data);
        return item;
      });
    });

    it('leaves the payout at its recorded amount and moves the rest onto salary', async () => {
      // 68,000 trimmed to 60,000: the 8,000 comes off salary, not the payout.
      await service.updatePayslip(COMPANY, 100, { totalEarnings: 60000 });

      expect(stored.find((i) => i.id === 2)!.amount).toBe(24000);
      expect(stored.find((i) => i.id === 1)!.amount).toBe(36000);
    });

    it('does not pay negative salary when the new total is below the payout', async () => {
      await service.updatePayslip(COMPANY, 100, { totalEarnings: 10000 });

      expect(stored.find((i) => i.id === 2)!.amount).toBe(24000);
      expect(stored.find((i) => i.id === 1)!.amount).toBe(0);
    });
  });
});
