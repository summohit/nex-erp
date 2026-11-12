import { AttendanceService } from './attendance.service';

/**
 * The comp-off history used figure comes from the approved requests, not the
 * stored balance counter. TKT: Ansh's balance said 1 used with no comp-off
 * taken — the counter had drifted from what the requests said.
 */
describe('getCompOffHistory comp-off used', () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  function make(storedUsed: number, requests: any[]) {
    const prisma: any = {
      leaveType: {
        findFirst: jest.fn(async () => ({ id: 14, name: 'Compensatory Off' })),
        findMany: jest.fn(async () => [{ id: 14, isCompOff: true }]),
      },
      leaveBalance: {
        findMany: jest.fn(async () => [
          { employeeId: 10, allocated: 2, used: storedUsed },
        ]),
      },
      compOffCredit: { findMany: jest.fn(async () => []) },
      employee: {
        findMany: jest.fn(async () => [
          {
            id: 10,
            firstName: 'Ansh',
            lastName: '.',
            employeeCode: 'T2003',
            avatarUrl: null,
            department: null,
            designation: null,
            weeklyOffs: '0',
            shift: null,
            branch: null,
          },
        ]),
      },
      holiday: { findMany: jest.fn(async () => []) },
      fieldVisitAttendance: { findMany: jest.fn(async () => []) },
      shiftRosterEntry: { findMany: jest.fn(async () => []) },
      leaveRequest: {
        findMany: jest.fn(async ({ where }: any) =>
          requests.filter(
            (r) => r.status === where.status && r.deletedAt === where.deletedAt,
          ),
        ),
      },
    };
    return new AttendanceService(prisma, {} as any, {} as any, {} as any);
  }

  it('counts the approved, non-deleted request even when the stored counter says otherwise', async () => {
    const service = make(5, [
      {
        id: 755,
        employeeId: 10,
        leaveTypeId: 14,
        startDate: d('2026-10-19'),
        endDate: d('2026-10-19'),
        isHalfDay: false,
        status: 'APPROVED',
        deletedAt: null,
        reason: 'Medical',
      },
    ]);

    const res: any = await service.getCompOffHistory(1, {
      role: 'EMPLOYEE',
      employeeId: 10,
    });

    expect(res.employees[0].used).toBe(1);
    expect(res.employees[0].remaining).toBe(1);
    expect(res.employees[0].used_leaves).toHaveLength(1);
  });

  it('shows zero when nothing was approved, regardless of the stored counter', async () => {
    const service = make(1, [
      {
        id: 756,
        employeeId: 10,
        leaveTypeId: 14,
        startDate: d('2026-10-20'),
        endDate: d('2026-10-20'),
        isHalfDay: false,
        status: 'PENDING',
        deletedAt: null,
        reason: 'Pending',
      },
    ]);

    const res: any = await service.getCompOffHistory(1, {
      role: 'EMPLOYEE',
      employeeId: 10,
    });

    expect(res.employees[0].used).toBe(0);
    expect(res.employees[0].remaining).toBe(2);
    expect(res.employees[0].used_leaves).toHaveLength(0);
  });
});
