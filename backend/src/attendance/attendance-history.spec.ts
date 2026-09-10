import { AttendanceService } from './attendance.service';

/**
 * Guards the egress fix. This endpoint used to attach a full copy of the
 * employee and their department to every row of a ~600-row history, which was
 * ~300 KB of pure duplication per call from both clients and was the main
 * driver of the Supabase egress overrun.
 */
describe('AttendanceService — history payload', () => {
  let prisma: any;
  let service: AttendanceService;

  beforeEach(() => {
    prisma = {
      employee: { findUnique: jest.fn(async () => ({ id: 29 })) },
      attendance: { findMany: jest.fn(async () => []) },
    };
    service = new AttendanceService(prisma, {} as any, {} as any);
  });

  const lastCall = () => prisma.attendance.findMany.mock.calls[0][0];

  it('never includes the employee or department relation', async () => {
    await service.getMyHistory(1);
    const query = lastCall();

    // The regression: `include: { employee: { include: { department: true } } }`.
    expect(query.include).toBeUndefined();
    expect(JSON.stringify(query.select)).not.toMatch(/employee|department/);
  });

  it('selects only the fields the grids render', async () => {
    await service.getMyHistory(1);
    const select = lastCall().select;

    expect(select).toMatchObject({ id: true, date: true, clockIn: true, clockOut: true, status: true });
    expect(select.logs?.select).toBeDefined();
  });

  it('bounds the range when the caller asks for everything', async () => {
    await service.getMyHistory(1);
    const where = lastCall().where;

    // Without this an employee with years of records ships all of them.
    expect(where.date?.gte).toBeInstanceOf(Date);
    const monthsBack = (Date.now() - where.date.gte.getTime()) / (1000 * 60 * 60 * 24 * 30);
    expect(monthsBack).toBeGreaterThan(11);
    expect(monthsBack).toBeLessThan(13);
  });

  it('honours an explicit from/to window', async () => {
    await service.getMyHistory(1, '2026-09-01', '2026-09-30');
    const where = lastCall().where;

    expect(where.date.gte.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(where.date.lte.toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('falls back to the default window when given garbage dates', async () => {
    await service.getMyHistory(1, 'not-a-date', 'also-not');
    const where = lastCall().where;

    // No global ValidationPipe exists, so the service must not hand an Invalid
    // Date straight to Prisma.
    expect(where.date.gte).toBeInstanceOf(Date);
    expect(isNaN(where.date.gte.getTime())).toBe(false);
    expect(where.date.lte).toBeUndefined();
  });

  it('scopes to the employee, and getEmployeeHistory takes the id directly', async () => {
    await service.getMyHistory(1);
    expect(lastCall().where.employeeId).toBe(29);

    prisma.attendance.findMany.mockClear();
    await service.getEmployeeHistory(77);
    expect(prisma.attendance.findMany.mock.calls[0][0].where.employeeId).toBe(77);
  });
});
