import { compOffUsedDays } from './comp-off-used';

/**
 * The comp-off rule: only APPROVED, non-deleted requests consume a day, and a
 * day is counted the way approval counted it (working days, half days, roster).
 *
 * The stored LeaveBalance.used is a counter and can drift; the screens show
 * what the requests say.
 */
describe('compOffUsedDays', () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  const leaveTypes = [
    { id: 14, isCompOff: true },
    { id: 1, isCompOff: false },
  ];
  const employees = [{ id: 10, weeklyOffs: '0', shift: null, branch: null }];

  function prismaFor(requests: any[]) {
    return {
      leaveType: { findMany: jest.fn(async () => leaveTypes) },
      employee: {
        findMany: jest.fn(async ({ where }: any) =>
          employees.filter((e) => where.id.in.includes(e.id)),
        ),
      },
      holiday: { findMany: jest.fn(async () => []) },
      shiftRosterEntry: { findMany: jest.fn(async () => []) },
      leaveRequest: {
        findMany: jest.fn(async ({ where }: any) =>
          requests.filter(
            (r) =>
              where.employeeId.in.includes(r.employeeId) &&
              where.leaveTypeId.in.includes(r.leaveTypeId) &&
              r.status === where.status &&
              (where.deletedAt === null ? r.deletedAt === null : true) &&
              r.startDate >= where.startDate.gte &&
              r.startDate < where.startDate.lt,
          ),
        ),
      },
    };
  }

  const req = (id: number, start: string, extra: any = {}) => ({
    id,
    employeeId: 10,
    leaveTypeId: 14,
    startDate: d(start),
    endDate: d(extra.end ?? start),
    isHalfDay: false,
    status: 'APPROVED',
    deletedAt: null,
    ...extra,
  });

  it('counts approved days and ignores pending, cancelled and deleted requests', async () => {
    const used = await compOffUsedDays(
      prismaFor([
        req(1, '2026-10-19'),
        req(2, '2026-10-20', { status: 'PENDING' }),
        req(3, '2026-10-21', { status: 'CANCELLED' }),
        req(4, '2026-10-22', { deletedAt: d('2026-10-23') }),
      ]),
      1,
      2026,
      [{ employeeId: 10, leaveTypeId: 14 }],
    );

    expect(used.get('10:14')).toBe(1);
  });

  it('counts a half day as half and a range by its working days', async () => {
    const used = await compOffUsedDays(
      prismaFor([
        req(1, '2026-10-23', { isHalfDay: true }),
        // Fri 27 – Mon 30 Nov: Sunday 29 is off, so three days.
        req(2, '2026-11-27', { end: '2026-11-30' }),
      ]),
      1,
      2026,
      [{ employeeId: 10, leaveTypeId: 14 }],
    );

    expect(used.get('10:14')).toBe(3.5);
  });

  it('returns zero for a comp-off balance with no requests, so the counter is replaced', async () => {
    const used = await compOffUsedDays(prismaFor([]), 1, 2026, [
      { employeeId: 10, leaveTypeId: 14 },
    ]);

    expect(used.has('10:14')).toBe(true);
    expect(used.get('10:14')).toBe(0);
  });

  it('leaves other leave types out of the map', async () => {
    const used = await compOffUsedDays(
      prismaFor([req(1, '2026-10-19')]),
      1,
      2026,
      [
        { employeeId: 10, leaveTypeId: 14 },
        { employeeId: 10, leaveTypeId: 1 },
      ],
    );

    expect(used.has('10:1')).toBe(false);
  });

  it('ignores a request from another year', async () => {
    const used = await compOffUsedDays(
      prismaFor([req(1, '2025-12-31')]),
      1,
      2026,
      [{ employeeId: 10, leaveTypeId: 14 }],
    );

    expect(used.get('10:14')).toBe(0);
  });
});
