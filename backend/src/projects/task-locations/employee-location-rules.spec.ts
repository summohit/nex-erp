import { TaskLocationsService } from './task-locations.service';

/**
 * An employee moves their own location between Not started, In progress and
 * Completed — nothing else, and not at all once the task is closed. Review,
 * Blocked and closing are the project manager's.
 */
describe('TaskLocationsService — what an employee may do to a location', () => {
  const make = (taskStatus: string) => {
    const prisma: any = {};
    const svc: any = new TaskLocationsService(prisma, { notifyEmployees: jest.fn() } as any, {} as any);
    svc.loadIssue = jest.fn(async () => ({
      id: 1, status: taskStatus, companyId: 1, projectId: 10, assigneeId: 5, reporterId: 9,
      members: [], project: { leadId: 9 }, seesAll: false,
    }));
    svc.loadRow = jest.fn(async () => ({
      id: 3, status: 'IN_PROGRESS', removedAt: null, startedAt: new Date(), assignees: [{ employeeId: 5 }],
      location: { name: 'Pune' }, remarks: null, blockedReason: null, startDate: null, dueDate: null,
    }));
    svc.manages = jest.fn(async () => false);
    return svc;
  };

  it.each(['BLOCKED', 'IN_REVIEW'])('refuses %s from an employee', async (status) => {
    await expect(make('IN_PROGRESS').updateRow(1, 10, 1, 3, 5, 'EMPLOYEE', { status }))
      .rejects.toThrow('Not started, In progress or Completed');
  });

  it('refuses any change once the task is done', async () => {
    await expect(make('DONE').updateRow(1, 10, 1, 3, 5, 'EMPLOYEE', { status: 'NOT_STARTED' }))
      .rejects.toThrow('closed');
  });
});
