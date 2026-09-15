import { LeaveAccrualCron } from './leave-accrual.cron';

/**
 * Accrual and the January opening run unattended, once a month, on
 * money-adjacent numbers. Two properties matter more than anything else here:
 *
 *  - a restart on the 1st must not credit twice (the old job had no guard at
 *    all, and its 24h-from-boot interval meant it barely ran in the first
 *    place); and
 *  - opening a year must not touch a balance that already exists. Leave no
 *    longer carries over — last year's unused days are paid out on the December
 *    payslip — so January's allocation is a fresh grant, and re-granting it on
 *    every boot would hand out free days all month.
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
  let employees: any[];

  const matches = (row: any, where: any): boolean => {
    if (where.leaveTypeId !== undefined && row.leaveTypeId !== where.leaveTypeId) return false;
    if (where.employeeId?.in !== undefined) {
      if (!where.employeeId.in.includes(row.employeeId)) return false;
    } else if (where.employeeId !== undefined && row.employeeId !== where.employeeId) return false;
    if (where.year !== undefined && row.year !== where.year) return false;
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
    employees = [];
    prisma = {
      leaveType: {
        findMany: jest.fn(async ({ where }: any) =>
          types.filter((t) => {
            if (where.defaultDays?.gt !== undefined) return t.defaultDays > where.defaultDays.gt;
            if (where.accrualAmount?.gt !== undefined && !(t.accrualAmount > where.accrualAmount.gt)) return false;
            if (where.accrualFrequency?.in && !where.accrualFrequency.in.includes(t.accrualFrequency)) return false;
            return true;
          }),
        ),
      },
      employee: {
        findMany: jest.fn(async ({ where }: any) =>
          employees.filter((e) => where.user?.status?.not !== e.status),
        ),
      },
      leaveBalance: {
        findMany: jest.fn(async ({ where }: any) => balances.filter((b) => matches(b, where))),
        createMany: jest.fn(async ({ data }: any) => {
          const fresh = data.filter((d: any) =>
            !balances.some((b) => b.employeeId === d.employeeId && b.leaveTypeId === d.leaveTypeId && b.year === d.year),
          );
          for (const d of fresh) balance(d);
          return { count: fresh.length };
        }),
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
      defaultDays: 0, companyId: 1, ...o,
    };
    types.push(t);
    return t;
  };
  const balance = (o: Partial<any>) => {
    const b = {
      employeeId: 1, leaveTypeId: 1, year: 2026,
      allocated: 0, used: 0, lastAccruedPeriod: null, ...o,
    };
    balances.push(b);
    return b;
  };
  const employee = (o: Partial<any> = {}) => {
    const e = { id: employees.length + 1, companyId: 1, status: 'ACTIVE', ...o };
    employees.push(e);
    return e;
  };

  describe('when it runs at all', () => {
    it('does nothing on any day but the 1st', async () => {
      type({ accrualAmount: 1.5 });
      const b = balance({});
      await expect(cron.run(ist(2026, 9, 15))).resolves.toEqual({ accrued: 0, opened: 0 });
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

  describe('opening a new year', () => {
    it('grants each active employee the type default, once', async () => {
      employee();
      employee();
      type({ defaultDays: 12 });

      await expect(cron.run(ist(2027, 1, 1))).resolves.toMatchObject({ opened: 2 });

      const opened = balances.filter((b) => b.year === 2027);
      expect(opened).toHaveLength(2);
      expect(opened.every((b) => b.allocated === 12 && b.used === 0)).toBe(true);
    });

    // The one that costs money if it breaks: the job fires on every boot, and
    // January has 31 days of boots in it.
    it('does not grant twice when the process restarts', async () => {
      employee();
      type({ defaultDays: 12 });

      await cron.run(ist(2027, 1, 1, 2));
      await cron.run(ist(2027, 1, 1, 9));
      await cron.run(ist(2027, 1, 15));

      expect(balances.filter((b) => b.year === 2027)).toHaveLength(1);
    });

    it('leaves an allocation HR already made alone', async () => {
      employee();
      const t = type({ defaultDays: 12 });
      // A negotiated 20 days, entered by hand before the job ran.
      const existing = balance({ leaveTypeId: t.id, year: 2027, allocated: 20, used: 3 });

      await expect(cron.run(ist(2027, 1, 1))).resolves.toMatchObject({ opened: 0 });
      expect(existing.allocated).toBe(20);
      expect(existing.used).toBe(3);
    });

    // The whole point of the policy change.
    it('starts from the default no matter what was left last year', async () => {
      employee();
      const t = type({ defaultDays: 12 });
      balance({ leaveTypeId: t.id, year: 2026, allocated: 12, used: 0 }); // 12 unused

      await cron.run(ist(2027, 1, 1));

      const next = balances.find((b) => b.year === 2027)!;
      expect(next.allocated).toBe(12);
    });

    it('skips types with no entitlement to grant', async () => {
      employee();
      type({ defaultDays: 0 }); // unpaid LOP

      await expect(cron.run(ist(2027, 1, 1))).resolves.toMatchObject({ opened: 0 });
      expect(balances).toHaveLength(0);
    });

    it('skips suspended staff, who are off payroll', async () => {
      employee({ status: 'SUSPENDED' });
      type({ defaultDays: 12 });

      await expect(cron.run(ist(2027, 1, 1))).resolves.toMatchObject({ opened: 0 });
    });

    it('does not grant a type from another company', async () => {
      employee({ companyId: 1 });
      type({ defaultDays: 12, companyId: 2 });

      await expect(cron.run(ist(2027, 1, 1))).resolves.toMatchObject({ opened: 0 });
    });

    it('only runs in January', async () => {
      employee();
      type({ defaultDays: 12 });

      await expect(cron.run(ist(2027, 6, 1))).resolves.toMatchObject({ opened: 0 });
      expect(balances).toHaveLength(0);
    });

    // Order matters: a YEARLY type credits on 1 January too, and it has to land
    // on the row the opening just created.
    it('credits January accrual onto the row it just opened', async () => {
      employee();
      type({ defaultDays: 12, accrualFrequency: 'YEARLY', accrualAmount: 3 });

      await cron.run(ist(2027, 1, 1));

      const next = balances.find((b) => b.year === 2027)!;
      expect(next.allocated).toBe(15);
    });
  });
});
