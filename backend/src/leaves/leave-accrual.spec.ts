import { LeaveAccrualCron } from './leave-accrual.cron';

/**
 * Accrual and carry-forward run unattended, once a month, on money-adjacent
 * numbers. Two properties matter more than anything else here:
 *
 *  - a restart on the 1st must not credit twice (the old job had no guard at
 *    all, and its 24h-from-boot interval meant it barely ran in the first
 *    place); and
 *  - carry-forward must happen exactly once per year — carriedOver was written
 *    by no code before this, so all 728 live rows still read 0.
 */
describe('LeaveAccrualCron', () => {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  /** An instant that is the given IST wall-clock date. */
  const ist = (y: number, m: number, d: number, hh = 10) =>
    new Date(Date.UTC(y, m - 1, d, hh) - IST_OFFSET_MS);

  let prisma: any;
  let cron: LeaveAccrualCron;
  let types: any[];
  let balances: any[];

  const matches = (row: any, where: any): boolean => {
    if (where.leaveTypeId !== undefined && row.leaveTypeId !== where.leaveTypeId) return false;
    if (where.employeeId !== undefined && row.employeeId !== where.employeeId) return false;
    if (where.year !== undefined && row.year !== where.year) return false;
    if (where.carriedForwardFromYear === null && row.carriedForwardFromYear !== null) return false;
    if (where.OR) {
      const ok = where.OR.some((c: any) =>
        (c.lastAccruedPeriod === null && row.lastAccruedPeriod === null) ||
        (c.lastAccruedPeriod?.not !== undefined &&
          row.lastAccruedPeriod !== null && row.lastAccruedPeriod !== c.lastAccruedPeriod.not),
      );
      if (!ok) return false;
    }
    return true;
  };

  beforeEach(() => {
    types = [];
    balances = [];
    prisma = {
      leaveType: {
        findMany: jest.fn(async ({ where }: any) =>
          types.filter((t) => {
            if (where.carryForward !== undefined) return t.carryForward === where.carryForward;
            if (where.accrualAmount?.gt !== undefined && !(t.accrualAmount > where.accrualAmount.gt)) return false;
            if (where.accrualFrequency?.in && !where.accrualFrequency.in.includes(t.accrualFrequency)) return false;
            return true;
          }),
        ),
      },
      leaveBalance: {
        findMany: jest.fn(async ({ where }: any) => balances.filter((b) => matches(b, where))),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const hits = balances.filter((b) => matches(b, where));
          for (const row of hits) {
            for (const [k, v] of Object.entries<any>(data)) {
              if (v && typeof v === 'object' && 'increment' in v) row[k] += v.increment;
              else row[k] = v;
            }
          }
          return { count: hits.length };
        }),
      },
    };
    cron = new LeaveAccrualCron(prisma);
  });

  const type = (o: Partial<any>) => {
    const t = {
      id: types.length + 1, name: `Type ${types.length + 1}`,
      accrualFrequency: 'MONTHLY', accrualAmount: 0,
      carryForward: false, carryForwardLimit: 0, ...o,
    };
    types.push(t);
    return t;
  };
  const balance = (o: Partial<any>) => {
    const b = {
      employeeId: 1, leaveTypeId: 1, year: 2026,
      allocated: 0, used: 0, carriedOver: 0,
      lastAccruedPeriod: null, carriedForwardFromYear: null, ...o,
    };
    balances.push(b);
    return b;
  };

  describe('when it runs at all', () => {
    it('does nothing on any day but the 1st', async () => {
      type({ accrualAmount: 1.5 });
      const b = balance({});
      await expect(cron.run(ist(2026, 9, 15))).resolves.toEqual({ accrued: 0, carried: 0 });
      expect(b.allocated).toBe(0);
    });

    it('uses the IST calendar, not the server clock', async () => {
      type({ accrualAmount: 1.5 });
      const b = balance({});
      // 2026-09-30 20:00 UTC is already 2026-10-01 in IST. A server on UTC
      // would call this the 30th and skip the credit for a whole month.
      await cron.run(new Date(Date.UTC(2026, 8, 30, 20, 0)));
      expect(b.lastAccruedPeriod).toBe('2026-10');
    });
  });

  describe('monthly accrual', () => {
    it('credits once on the 1st', async () => {
      type({ accrualAmount: 1.5 });
      const b = balance({});
      await cron.run(ist(2026, 9, 1));
      expect(b.allocated).toBe(1.5);
      expect(b.lastAccruedPeriod).toBe('2026-09');
    });

    // The regression that matters: deploys and pm2 restarts re-run this.
    it('does not credit twice when the process restarts the same day', async () => {
      type({ accrualAmount: 1.5 });
      const b = balance({});

      await cron.run(ist(2026, 9, 1, 2));
      await cron.run(ist(2026, 9, 1, 9));
      await cron.run(ist(2026, 9, 1, 23));

      expect(b.allocated).toBe(1.5);
    });

    it('credits again the following month', async () => {
      type({ accrualAmount: 1.5 });
      const b = balance({});
      await cron.run(ist(2026, 9, 1));
      await cron.run(ist(2026, 10, 1));
      expect(b.allocated).toBe(3);
      expect(b.lastAccruedPeriod).toBe('2026-10');
    });

    it('skips types with no amount — which is every live type today', async () => {
      type({ accrualAmount: 0, accrualFrequency: 'MONTHLY' });
      const b = balance({});
      await expect(cron.run(ist(2026, 9, 1))).resolves.toMatchObject({ accrued: 0 });
      expect(b.allocated).toBe(0);
      expect(b.lastAccruedPeriod).toBeNull();
    });
  });

  describe('yearly accrual', () => {
    it('credits only in January', async () => {
      type({ accrualFrequency: 'YEARLY', accrualAmount: 12 });
      const b = balance({});

      await cron.run(ist(2026, 6, 1));
      expect(b.allocated).toBe(0);

      await cron.run(ist(2026, 1, 1));
      expect(b.allocated).toBe(12);
      expect(b.lastAccruedPeriod).toBe('2026');
    });
  });

  describe('carry-forward', () => {
    const setup = (limit: number, prev: Partial<any>) => {
      const t = type({ carryForward: true, carryForwardLimit: limit, accrualAmount: 0 });
      balance({ leaveTypeId: t.id, year: 2026, ...prev });
      return balance({ leaveTypeId: t.id, year: 2027 });
    };

    it('rolls unused days into the new year, capped at the limit', async () => {
      const next = setup(5, { allocated: 15, used: 2 }); // 13 remaining

      await cron.run(ist(2027, 1, 1));

      expect(next.carriedOver).toBe(5);
      expect(next.carriedForwardFromYear).toBe(2026);
    });

    it('rolls the whole remainder when it is under the limit', async () => {
      const next = setup(30, { allocated: 15, used: 12 }); // 3 remaining
      await cron.run(ist(2027, 1, 1));
      expect(next.carriedOver).toBe(3);
    });

    it("counts last year's own carry-over as available", async () => {
      // Otherwise days rolled in one January are lost the next.
      const next = setup(30, { allocated: 10, carriedOver: 4, used: 2 }); // 12 remaining
      await cron.run(ist(2027, 1, 1));
      expect(next.carriedOver).toBe(12);
    });

    it('treats a limit of 0 as no cap, since the field only exists once carry-forward is on', async () => {
      const next = setup(0, { allocated: 15, used: 0 });
      await cron.run(ist(2027, 1, 1));
      expect(next.carriedOver).toBe(15);
    });

    it('carries nothing when the year was fully used', async () => {
      const next = setup(5, { allocated: 10, used: 10 });
      await cron.run(ist(2027, 1, 1));
      expect(next.carriedOver).toBe(0);
      expect(next.carriedForwardFromYear).toBeNull();
    });

    it('does not roll twice, even across restarts', async () => {
      const next = setup(5, { allocated: 15, used: 2 });

      await cron.run(ist(2027, 1, 1, 3));
      await cron.run(ist(2027, 1, 1, 18));

      expect(next.carriedOver).toBe(5);
    });

    it('leaves types that do not carry forward alone', async () => {
      const t = type({ carryForward: false });
      balance({ leaveTypeId: t.id, year: 2026, allocated: 10, used: 0 });
      const next = balance({ leaveTypeId: t.id, year: 2027 });

      await cron.run(ist(2027, 1, 1));
      expect(next.carriedOver).toBe(0);
    });

    it('only runs in January', async () => {
      const next = setup(5, { allocated: 15, used: 2 });
      await cron.run(ist(2027, 6, 1));
      expect(next.carriedOver).toBe(0);
    });

    it('skips an employee with no balance row in the new year', async () => {
      const t = type({ carryForward: true, carryForwardLimit: 5 });
      balance({ employeeId: 99, leaveTypeId: t.id, year: 2026, allocated: 10, used: 0 });
      // No 2027 row for employee 99.
      await expect(cron.run(ist(2027, 1, 1))).resolves.toMatchObject({ carried: 0 });
    });
  });
});
