import { PayrollService } from './payroll.service';

/**
 * The preview has to say what the run will do.
 *
 * September 2026 had roughly 60% of its working days recorded — the clock-in
 * was broken for part of the month and the Workway import stopped on the 21st
 * — and generating from that would have deducted 46% of gross as loss of pay,
 * for days people worked. The preview exists so that is visible before the
 * button is pressed rather than on payslips people have already been shown.
 *
 * It is a second implementation of the loss-of-pay rule, because generation is
 * the code that pays people and is not worth destabilising for a read-only
 * view. That is a deliberate duplication, and duplicated rules drift. These
 * tests are what stops them: every case runs BOTH paths over the same data and
 * insists they agree. A change to one that the other does not follow fails
 * here, rather than showing somebody a number their payslip then contradicts.
 */
describe('PayrollService — the preview agrees with the run', () => {
  const COMPANY = 1;
  const EMPLOYEE = 7;
  const GROSS = 44000;
  const DEDUCTION = 4000;

  let prisma: any;
  let service: PayrollService;
  let attendance: any[];
  let leaves: any[];

  /** A PRESENT row for each given day of September 2026. */
  const presentOn = (days: number[]) =>
    days.map((d) => ({ date: new Date(2026, 8, d), status: 'PRESENT' }));

  beforeEach(() => {
    attendance = [];
    leaves = [];

    prisma = {
      payslip: {
        findMany: jest.fn(async ({ include }: any) => (include ? [{ id: 100 }] : [])),
        upsert: jest.fn(async ({ create }: any) => ({ id: 100, ...create })),
      },
      payslipItem: {
        deleteMany: jest.fn(async () => {}),
        createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
      },
      leaveEncashment: {
        deleteMany: jest.fn(async () => {}),
        createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
      },
      leaveBalance: { findMany: jest.fn(async () => []) },
      employee: {
        findMany: jest.fn(async () => [
          {
            id: EMPLOYEE,
            firstName: 'Afnan',
            lastName: 'Ali',
            branch: { weeklyOffs: '0' }, // Sundays off -> 26 working days in Sept 2026
            salaryStructures: [
              { amount: GROSS, component: { name: 'Basic Salary', type: 'EARNING' } },
              { amount: DEDUCTION, component: { name: 'Provident Fund (PF)', type: 'DEDUCTION' } },
            ],
          },
        ]),
      },
      attendance: { findMany: jest.fn(async () => attendance) },
      leaveRequest: { findMany: jest.fn(async () => leaves) },
      expenseClaim: {
        findMany: jest.fn(async () => []),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };

    service = new PayrollService(prisma, {} as any, {} as any);
  });

  /** Loss of pay as the generator wrote it to the slip. */
  const generated = async (opts?: { skipLossOfPay?: boolean }) => {
    await service.generatePayslips(COMPANY, 9, 2026, opts ?? {});
    return prisma.payslip.upsert.mock.calls[0][0].create;
  };

  const previewed = async () => {
    const p = await service.previewPayroll(COMPANY, 9, 2026);
    return { summary: p, row: p.rows[0] };
  };

  describe.each([
    ['a month nothing was recorded for', [] as number[]],
    ['the thin month that started all this', [1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18]],
    ['a full month', Array.from({ length: 30 }, (_, i) => i + 1)],
  ])('%s', (_label, days) => {
    beforeEach(() => {
      attendance = presentOn(days);
    });

    it('computes the same loss of pay either way', async () => {
      const slip = await generated();
      const { row } = await previewed();
      expect(row.lossOfPay).toBeCloseTo(slip.lossOfPay, 2);
    });

    it('counts the same absences and working days', async () => {
      const slip = await generated();
      const { row } = await previewed();
      expect(row.workingDays).toBe(slip.workingDays);
      expect(row.absences).toBeCloseTo(slip.absentDays, 2);
      expect(row.presentDays).toBeCloseTo(slip.presentDays, 2);
    });
  });

  it('does not charge for a day approved leave covers', async () => {
    attendance = presentOn([1, 2, 3]);
    leaves = [{ startDate: new Date(2026, 8, 4), endDate: new Date(2026, 8, 30) }];

    const slip = await generated();
    const { row } = await previewed();
    expect(row.lossOfPay).toBeCloseTo(slip.lossOfPay, 2);
    expect(row.lossOfPay).toBe(0);
  });

  /**
   * The waiver is the whole point of the preview: you look at the damage, then
   * decide to pay without it. If it did not actually zero the deduction the
   * decision would be theatre.
   */
  it('waives loss of pay entirely when asked, and only then', async () => {
    attendance = presentOn([1, 2, 3]);

    const charged = await generated();
    expect(charged.lossOfPay).toBeGreaterThan(0);

    prisma.payslip.upsert.mockClear();
    const waived = await generated({ skipLossOfPay: true });
    expect(waived.lossOfPay).toBe(0);
    // Gross is untouched: the deduction is waived, not the salary rewritten.
    expect(waived.totalEarnings).toBe(charged.totalEarnings);
    expect(waived.netPay).toBeGreaterThan(charged.netPay);
  });

  /** Somebody with no record at all is a different problem from a patchy month. */
  it('says who has no attendance whatsoever', async () => {
    attendance = [];
    const { summary, row } = await previewed();
    expect(row.noAttendance).toBe(true);
    expect(summary.noAttendance).toBe(1);
  });

  /**
   * Reading a period must not create one.
   *
   * getPayslips used to generate a whole month when it found none, so an empty
   * period could not exist: September 2026 was deleted three times and was
   * back within seconds each time, because opening the tab regenerated it. It
   * also skipped the pre-flight entirely — drafts carrying ₹15.1 lakh of loss
   * of pay appeared without anybody pressing a button.
   */
  it('does not generate payslips just because a period is empty', async () => {
    prisma.payslip.findMany = jest.fn(async () => []);
    prisma.payslip.upsert.mockClear();

    const out = await service.getPayslips(COMPANY, 9, 2026);

    expect(out).toEqual([]);
    expect(prisma.payslip.upsert).not.toHaveBeenCalled();
  });

  it('reports the share of gross that would be lost', async () => {
    attendance = presentOn([1, 2, 3]);
    const { summary } = await previewed();
    expect(summary.lossOfPayShare).toBeCloseTo(summary.totalLossOfPay / summary.totalGross, 6);
    expect(summary.severelyAffected).toBe(1); // over half their pay
  });
});
