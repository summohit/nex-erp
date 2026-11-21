import { IssuesService } from './issues.service';

describe('IssuesService task timer idempotency', () => {
  const issue = { id: 9, companyId: 1, projectId: 2, workCompletedAt: null };
  let rows: any[];
  let prisma: any;
  let gateway: any;
  let service: any;

  beforeEach(() => {
    rows = [];
    prisma = {
      issue: {
        findUnique: jest.fn(async () => issue),
        update: jest.fn(async () => issue),
      },
      issueTimeLog: {
        findFirst: jest.fn(async () => rows.find((row) => row.endedAt === null) ?? null),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: rows.length + 1, endedAt: null, durationMin: null, ...data };
          rows.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = rows.find((item) => item.id === where.id);
          Object.assign(row, data);
          return row;
        }),
      },
      issueActivity: { create: jest.fn(async ({ data }: any) => ({ id: 100, ...data, createdAt: new Date() })) },
    };
    gateway = { emitActivityAdded: jest.fn() };
    service = new IssuesService(prisma, gateway, {} as any, {} as any);
    service.loadTaskHoursState = jest.fn(async () => ({ estimatedHours: null, additionalHours: 0, loggedMinutes: 0 }));
    service.promoteFromTodoOnWork = jest.fn(async () => undefined);
  });

  it('turns concurrent starts into one timer and one activity entry', async () => {
    const result = await Promise.all([
      service.startTimerForEmployee(1, 7, 2, 9),
      service.startTimerForEmployee(1, 7, 2, 9),
    ]);

    expect(rows).toHaveLength(1);
    expect(result.filter((entry: any) => entry.alreadyRunning)).toHaveLength(1);
    expect(prisma.issueActivity.create).toHaveBeenCalledTimes(1);
  });

  it('turns a repeated stop into a no-op without a second activity entry', async () => {
    rows.push({ id: 1, issueId: 9, employeeId: 7, startedAt: new Date(Date.now() - 60_000), endedAt: null });

    const result = await Promise.all([
      service.stopTimerForEmployee(1, 7, 2, 9),
      service.stopTimerForEmployee(1, 7, 2, 9),
    ]);

    expect(prisma.issueTimeLog.update).toHaveBeenCalledTimes(1);
    expect(result.filter((entry: any) => entry.alreadyStopped)).toHaveLength(1);
    expect(prisma.issueActivity.create).toHaveBeenCalledTimes(1);
  });
});
