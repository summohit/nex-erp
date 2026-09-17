import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TimesheetsService } from './timesheets.service';

/**
 * §20: Login − Logged = Unlogged. Unlogged is the number the screen exists
 * for, so the edges around it are what these tests pin down.
 */
const DAY = '2026-09-14';
const at = (h: number, m = 0) => new Date(`${DAY}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);

function makeService(over: any = {}) {
  const prisma: any = {
    employee: { findFirst: jest.fn().mockResolvedValue({ id: 60, firstName: 'Rahul', lastName: 'K' }) },
    attendance: { findMany: jest.fn().mockResolvedValue([]) },
    issueTimeLog: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    timesheetDay: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation((a: any) => Promise.resolve(a)),
      update: jest.fn().mockImplementation((a: any) => Promise.resolve(a)),
    },
    ...over,
  };
  return { service: new TimesheetsService(prisma), prisma };
}

const attendance = (clockIn: Date | null, clockOut: Date | null, extra: any = {}) => ([
  { date: new Date(`${DAY}T00:00:00Z`), clockIn, clockOut, autoClockedOut: false, missedClockOut: false, ...extra },
]);

const timeLog = (minutes: number) => ({
  id: 1, startedAt: at(10), endedAt: at(11), durationMin: minutes, source: 'TIMER',
  issue: { id: 5, key: 'CES-5', title: 'Work', project: { id: 1, name: 'P', key: 'CES/1', client: null }, taskType: null },
});

const week = (s: TimesheetsService, prisma: any) => s.getWeek(1, 60, DAY, DAY);

describe('login, logged and unlogged hours', () => {
  it('computes unlogged as the gap between the two', async () => {
    const { service, prisma } = makeService();
    prisma.attendance.findMany.mockResolvedValue(attendance(at(9), at(18)));   // 9h
    prisma.issueTimeLog.findMany.mockResolvedValue([timeLog(360)]);            // 6h

    const { days, totals } = await week(service, prisma);

    expect(days[0].loginHours).toBe(9);
    expect(days[0].loggedHours).toBe(6);
    expect(days[0].unloggedHours).toBe(3);
    expect(totals).toEqual({ loginHours: 9, loggedHours: 6, unloggedHours: 3 });
  });

  // A day still running is not a fact yet. Counting up to "now" would make
  // unlogged hours climb through the afternoon on their own.
  it('counts nothing for a session that is still open', async () => {
    const { service, prisma } = makeService();
    prisma.attendance.findMany.mockResolvedValue(attendance(at(9), null));
    prisma.issueTimeLog.findMany.mockResolvedValue([timeLog(120)]);

    const { days } = await week(service, prisma);

    expect(days[0].loginHours).toBe(0);
    expect(days[0].sessionOpen).toBe(true);
    expect(days[0].unloggedHours).toBe(0);
  });

  // Booking more than you were clocked in for is a data problem, not nine
  // hours of unlogged time.
  it('never reports negative unlogged hours, and flags the over-booking', async () => {
    const { service, prisma } = makeService();
    prisma.attendance.findMany.mockResolvedValue(attendance(at(9), at(13)));   // 4h
    prisma.issueTimeLog.findMany.mockResolvedValue([timeLog(480)]);            // 8h

    const { days } = await week(service, prisma);

    expect(days[0].unloggedHours).toBe(0);
    expect(days[0].overLogged).toBe(true);
  });

  it('reports a day with no attendance at all as nothing logged and nothing owed', async () => {
    const { service } = makeService();

    const { days } = await service.getWeek(1, 60, DAY, DAY);

    expect(days[0].loginHours).toBe(0);
    expect(days[0].loggedHours).toBe(0);
    expect(days[0].unloggedHours).toBe(0);
    expect(days[0].status).toBe('NOT_SUBMITTED');
  });

  // The bug this caught: dayKey once used UTC, so east of Greenwich every
  // log was filed under the previous day and the grid came back empty.
  it('files a log under the local day it happened on', async () => {
    const { service, prisma } = makeService();
    prisma.issueTimeLog.findMany.mockResolvedValue([timeLog(60)]);

    const { days } = await service.getWeek(1, 60, DAY, DAY);

    expect(days).toHaveLength(1);
    expect(days[0].date).toBe(DAY);
    expect(days[0].loggedHours).toBe(1);
  });

  it('rejects an unparseable date range', async () => {
    const { service } = makeService();
    await expect(service.getWeek(1, 60, 'nonsense', 'nonsense')).rejects.toThrow(BadRequestException);
  });

  it('404s for an employee in another company', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.getWeek(1, 60, DAY, DAY)).rejects.toThrow(NotFoundException);
  });
});

describe('submitting a day', () => {
  it('refuses a day with nothing logged', async () => {
    const { service } = makeService();
    await expect(service.submitDay(1, 60, DAY)).rejects.toThrow(/no hours logged/);
  });

  it('stores the hours as they stood at submission', async () => {
    const { service, prisma } = makeService();
    prisma.attendance.findMany.mockResolvedValue(attendance(at(9), at(18)));
    prisma.issueTimeLog.findMany.mockResolvedValue([timeLog(360)]);

    await service.submitDay(1, 60, DAY);

    expect(prisma.timesheetDay.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ submittedHours: 6, status: 'SUBMITTED' }) }),
    );
  });

  // Reopening an approval is a reviewer's action, not the employee's.
  it('refuses to re-submit an approved day', async () => {
    const { service, prisma } = makeService();
    prisma.attendance.findMany.mockResolvedValue(attendance(at(9), at(18)));
    prisma.issueTimeLog.findMany.mockResolvedValue([timeLog(360)]);
    prisma.timesheetDay.findUnique.mockResolvedValue({ id: 1, status: 'APPROVED' });

    await expect(service.submitDay(1, 60, DAY)).rejects.toThrow(/already been approved/);
  });

  it('clears a previous rejection when re-submitting', async () => {
    const { service, prisma } = makeService();
    prisma.attendance.findMany.mockResolvedValue(attendance(at(9), at(18)));
    prisma.issueTimeLog.findMany.mockResolvedValue([timeLog(360)]);
    prisma.timesheetDay.findUnique.mockResolvedValue({ id: 1, status: 'REJECTED' });

    await service.submitDay(1, 60, DAY);

    const update = prisma.timesheetDay.upsert.mock.calls[0][0].update;
    expect(update.rejectionReason).toBeNull();
    expect(update.reviewedById).toBeNull();
    expect(update.status).toBe('SUBMITTED');
  });
});

describe('reviewing a day', () => {
  const submitted = { id: 9 };

  it('requires a reason to reject', async () => {
    const { service } = makeService();
    await expect(service.reviewDay(1, 70, 'ADMIN', 60, DAY, 'REJECTED', '  '))
      .rejects.toThrow(/reason is required/);
  });

  it('approves without one', async () => {
    const { service, prisma } = makeService();
    prisma.timesheetDay.findUnique.mockResolvedValue(submitted);

    await service.reviewDay(1, 70, 'ADMIN', 60, DAY, 'APPROVED');

    expect(prisma.timesheetDay.update.mock.calls[0][0].data.status).toBe('APPROVED');
  });

  it('stops a non-admin reviewing their own timesheet', async () => {
    const { service } = makeService();
    await expect(service.reviewDay(1, 60, 'EMPLOYEE', 60, DAY, 'APPROVED'))
      .rejects.toThrow(ForbiddenException);
  });

  // A project manager reviews the work done for them, not everything a
  // person happened to do that day.
  it('refuses a manager with no project in that day', async () => {
    const { service, prisma } = makeService();
    prisma.issueTimeLog.findFirst.mockResolvedValue(null);

    await expect(service.reviewDay(1, 80, 'EMPLOYEE', 60, DAY, 'APPROVED'))
      .rejects.toThrow(/do not manage a project/);
  });

  it('allows a manager whose project the person booked to', async () => {
    const { service, prisma } = makeService();
    prisma.issueTimeLog.findFirst.mockResolvedValue({ id: 1 });
    prisma.timesheetDay.findUnique.mockResolvedValue(submitted);

    await expect(service.reviewDay(1, 80, 'EMPLOYEE', 60, DAY, 'APPROVED')).resolves.toBeDefined();
  });

  it('404s on a day that was never submitted', async () => {
    const { service, prisma } = makeService();
    prisma.timesheetDay.findUnique.mockResolvedValue(null);

    await expect(service.reviewDay(1, 70, 'ADMIN', 60, DAY, 'APPROVED')).rejects.toThrow(NotFoundException);
  });
});

/**
 * §21: the team, admin and finance views. One screen with a scope switch, so
 * the questions worth pinning down are who each scope lists, what it refuses,
 * and when a number on it stops meaning what it says.
 */
describe('the overview scopes', () => {
  const overviewService = (over: any = {}) =>
    makeService({
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 60 }),
        findMany: jest.fn().mockResolvedValue([
          { id: 60, firstName: 'Rahul', lastName: 'K', avatarUrl: null, employeeCode: '1',
            hourlyCostRate: 500, department: { id: 2, name: 'Delivery' } },
        ]),
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      ...over,
    });

  const run = (s: TimesheetsService, scope: any, role = 'ADMIN', filters: any = {}) =>
    s.getOverview(1, 70, role, scope, DAY, DAY, filters);

  it('refuses ALL to someone who is not an administrator', async () => {
    const { service } = overviewService();
    await expect(run(service, 'ALL', 'EMPLOYEE')).rejects.toThrow(ForbiddenException);
  });

  it('refuses FINANCE to someone outside finance', async () => {
    const { service } = overviewService();
    await expect(run(service, 'FINANCE', 'EMPLOYEE')).rejects.toThrow(ForbiddenException);
  });

  it('lets finance see cost hours', async () => {
    const { service } = overviewService();
    const out = await run(service, 'FINANCE', 'FINANCE');
    expect(out.canViewCost).toBe(true);
  });

  // Rule 1: a normal employee never sees what anybody costs.
  it('never sends a cost figure to someone who may not see money', async () => {
    const { service, prisma } = overviewService();
    prisma.issueTimeLog.findMany.mockResolvedValue([{ ...timeLog(120), employeeId: 60 }]);

    const out = await run(service, 'TEAM', 'EMPLOYEE');

    expect(out.canViewCost).toBe(false);
    expect(out.employees[0]?.cost).toBeUndefined();
  });

  it('costs logged hours at the employee rate', async () => {
    const { service, prisma } = overviewService();
    prisma.issueTimeLog.findMany.mockResolvedValue([{ ...timeLog(120), employeeId: 60 }]);

    const out = await run(service, 'FINANCE', 'FINANCE');

    expect(out.employees[0].cost).toEqual({ hourlyRate: 500, amount: 1000, unratedHours: 0 });
  });

  // Phase 2's rule, carried forward: an unpriced person is reported as
  // unpriced, never silently costed at zero.
  it('reports unpriced hours instead of costing them at zero', async () => {
    const { service, prisma } = overviewService({
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 60 }),
        findMany: jest.fn().mockResolvedValue([
          { id: 60, firstName: 'Rahul', lastName: 'K', avatarUrl: null, employeeCode: '1',
            hourlyCostRate: null, department: null },
        ]),
      },
    });
    prisma.issueTimeLog.findMany.mockResolvedValue([{ ...timeLog(120), employeeId: 60 }]);

    const out = await run(service, 'FINANCE', 'FINANCE');

    expect(out.employees[0].cost).toEqual({ hourlyRate: null, amount: null, unratedHours: 2 });
    expect(out.totals.cost).toBe(0);
    expect(out.totals.unratedHours).toBe(2);
  });

  // Narrowing the logs changes what "logged" means, so unlogged hours stop
  // being the gap they claim to be and the screen is told to hide them.
  it('flags that hours are filtered when a project filter is on', async () => {
    const { service } = overviewService();
    const out = await run(service, 'ALL', 'ADMIN', { projectId: 7 });
    expect(out.hoursFiltered).toBe(true);
  });

  it('does not flag a filter that only narrows who is listed', async () => {
    const { service } = overviewService();
    const out = await run(service, 'ALL', 'ADMIN', { departmentId: 2 });
    expect(out.hoursFiltered).toBe(false);
  });

  // A PM's team is the people on their projects. With no project and no
  // members there is nobody to review, and the screen says so rather than
  // falling back to the whole company.
  it('lists nobody for a manager with no projects', async () => {
    const { service } = overviewService();
    const out = await run(service, 'TEAM', 'EMPLOYEE');
    expect(out.employees).toEqual([]);
    expect(out.totals.loggedHours).toBe(0);
  });

  it('excludes the reviewer from their own team list', async () => {
    const { service, prisma } = overviewService({
      projectMember: { findMany: jest.fn().mockResolvedValue([{ employeeId: 70 }]) },
    });
    prisma.issueTimeLog.findMany.mockResolvedValue([]);

    const out = await run(service, 'TEAM', 'EMPLOYEE');

    expect(out.employees).toEqual([]);
  });

  it('rejects an unparseable date range', async () => {
    const { service } = overviewService();
    await expect(run(service, 'ALL', 'ADMIN')).resolves.toBeDefined();
    await expect(service.getOverview(1, 70, 'ADMIN', 'ALL', 'nope', 'nope')).rejects.toThrow(BadRequestException);
  });
});

/**
 * The migrated Workway history was imported with its unstopped timers left in,
 * on the view that a day nobody can explain is worse than a day marked odd.
 * These pin down that the marking actually reaches the days that need it.
 */
describe('days that do not add up', () => {
  it('flags a single entry too long to be a real sitting', async () => {
    const { service, prisma } = makeService();
    prisma.attendance.findMany.mockResolvedValue(attendance(at(9), at(18)));
    prisma.issueTimeLog.findMany.mockResolvedValue([timeLog(21 * 60 + 28)]);

    const { days } = await week(service, prisma);

    expect(days[0].hasImplausibleEntry).toBe(true);
    expect(days[0].longestEntryHours).toBe(21.47);
  });

  it('leaves a long but plausible day alone', async () => {
    const { service, prisma } = makeService();
    prisma.attendance.findMany.mockResolvedValue(attendance(at(9), at(21)));
    prisma.issueTimeLog.findMany.mockResolvedValue([timeLog(11 * 60)]);

    const { days } = await week(service, prisma);

    expect(days[0].hasImplausibleEntry).toBe(false);
  });

  // The case overLogged cannot see: a weekend with hours booked and no
  // clock-in has no login figure to be "over".
  it('flags time booked on a day with no attendance at all', async () => {
    const { service, prisma } = makeService();
    prisma.issueTimeLog.findMany.mockResolvedValue([timeLog(22 * 60 + 34)]);

    const { days } = await week(service, prisma);

    expect(days[0].overLogged).toBe(false);
    expect(days[0].loggedWithoutLogin).toBe(true);
  });

  it('does not flag an ordinary empty day', async () => {
    const { service } = makeService();
    const { days } = await service.getWeek(1, 60, DAY, DAY);
    expect(days[0].loggedWithoutLogin).toBe(false);
    expect(days[0].hasImplausibleEntry).toBe(false);
  });
});

/**
 * A day still running. The rule — an open session counts nothing — is only
 * defensible if the screen can tell the difference between "no login hours
 * yet" and "no attendance at all", so both facts have to survive to the client.
 */
describe('a day that is still open', () => {
  it('reports zero login hours but keeps the clock-in', async () => {
    const { service, prisma } = makeService();
    prisma.attendance.findMany.mockResolvedValue(attendance(at(9, 28), null));

    const { days } = await week(service, prisma);

    expect(days[0].loginHours).toBe(0);
    expect(days[0].sessionOpen).toBe(true);
    expect(days[0].clockIn).toEqual(at(9, 28));
  });

  // The distinction the team view needs: nobody clocked in at all.
  it('is distinguishable from a day with no attendance', async () => {
    const { service } = makeService();
    const { days } = await service.getWeek(1, 60, DAY, DAY);

    expect(days[0].sessionOpen).toBe(false);
    expect(days[0].clockIn).toBeNull();
  });
});

/**
 * The last two §21 filters. Both narrow the LOGS rather than the people, so
 * both have to set `hoursFiltered` — otherwise the screen keeps printing an
 * unlogged column computed against a whole day it is no longer showing.
 */
describe('the task and billable filters', () => {
  const svc = () =>
    makeService({
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 60 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    });

  const run = (s: TimesheetsService, filters: any) =>
    s.getOverview(1, 70, 'ADMIN', 'ALL', DAY, DAY, filters);

  it('treats a task search as narrowing the hours', async () => {
    const { service } = svc();
    const out = await run(service, { task: 'racking' });
    expect(out.hoursFiltered).toBe(true);
  });

  it('treats a billable filter as narrowing the hours', async () => {
    const { service } = svc();
    const out = await run(service, { billable: 'BILLABLE' });
    expect(out.hoursFiltered).toBe(true);
  });

  // Billable is derived from Project.billingType, not a flag of its own: a
  // project billed hourly or fixed-price is billable work, and a second field
  // would only ever drift from the first.
  it('reads billable off the project billing type', async () => {
    const { service, prisma } = makeService({
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 60 }),
        findMany: jest.fn().mockResolvedValue([
          { id: 60, firstName: 'R', lastName: 'K', avatarUrl: null, employeeCode: '1',
            hourlyCostRate: null, department: null, user: { status: 'ACTIVE' } },
        ]),
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    });

    await service.getOverview(1, 70, 'ADMIN', 'ALL', DAY, DAY, { billable: 'BILLABLE' });

    const where = prisma.issueTimeLog.findMany.mock.calls.at(-1)[0].where;
    expect(where.issue.project.billingType).toEqual({ not: 'NON_BILLABLE' });
  });

  it('asks for non-billable projects exactly', async () => {
    const { service, prisma } = makeService({
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 60 }),
        findMany: jest.fn().mockResolvedValue([
          { id: 60, firstName: 'R', lastName: 'K', avatarUrl: null, employeeCode: '1',
            hourlyCostRate: null, department: null, user: { status: 'ACTIVE' } },
        ]),
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    });

    await service.getOverview(1, 70, 'ADMIN', 'ALL', DAY, DAY, { billable: 'NON_BILLABLE' });

    const where = prisma.issueTimeLog.findMany.mock.calls.at(-1)[0].where;
    expect(where.issue.project.billingType).toBe('NON_BILLABLE');
  });

  it('searches a task by key as well as title', async () => {
    const { service, prisma } = makeService({
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 60 }),
        findMany: jest.fn().mockResolvedValue([
          { id: 60, firstName: 'R', lastName: 'K', avatarUrl: null, employeeCode: '1',
            hourlyCostRate: null, department: null, user: { status: 'ACTIVE' } },
        ]),
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    });

    await service.getOverview(1, 70, 'ADMIN', 'ALL', DAY, DAY, { task: 'CES-5' });

    const where = prisma.issueTimeLog.findMany.mock.calls.at(-1)[0].where;
    expect(where.issue.OR).toEqual([
      { title: { contains: 'CES-5', mode: 'insensitive' } },
      { key: { contains: 'CES-5', mode: 'insensitive' } },
    ]);
  });

  it('ignores a blank task search rather than matching everything', async () => {
    const { service } = svc();
    const out = await run(service, { task: '   ' });
    expect(out.hoursFiltered).toBe(false);
  });
});
