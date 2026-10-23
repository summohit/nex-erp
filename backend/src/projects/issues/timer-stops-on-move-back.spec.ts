import { IssuesService } from './issues.service';

/**
 * A card dragged into In Progress starts its timer; dragging it out again —
 * back to To Do as much as on to Review — has to stop it, or the task keeps
 * accruing time nobody is spending on it.
 */
describe('IssuesService — the timer stops when a card leaves In Progress', () => {
  const columns: Record<number, any> = {
    1: { id: 1, name: 'To Do', type: 'TODO', position: 0 },
    2: { id: 2, name: 'In Progress', type: 'IN_PROGRESS', position: 1 },
    3: { id: 3, name: 'In Review', type: 'IN_REVIEW', position: 2 },
  };

  const make = (timerRunning: boolean) => {
    const prisma: any = {
      issue: {
        findUnique: jest.fn(async () => ({
          id: 1, projectId: 10, companyId: 1, assigneeId: 4, columnId: 2, status: 'IN_PROGRESS',
          workStartedAt: timerRunning ? new Date() : null, workCompletedAt: null,
        })),
        findUniqueOrThrow: jest.fn(async () => ({ id: 1 })),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({ id: 1 })),
      },
      boardColumn: {
        findUnique: jest.fn(async ({ where }: any) => columns[where.id]),
        findMany: jest.fn(async () => Object.values(columns)),
      },
      projectMember: { findFirst: jest.fn(async () => null) },
      rolePermission: { findFirst: jest.fn(async () => null) },
      project: { findFirst: jest.fn(async () => ({ leadId: 99 })), findUnique: jest.fn(async () => ({ leadId: 99, name: 'P' })) },
      employee: { findUnique: jest.fn(async () => ({ firstName: 'A', lastName: 'B' })), findFirst: jest.fn(async () => null) },
      issueActivity: { create: jest.fn(async () => ({})) },
      issueMember: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
      issueTimeLog: { findFirst: jest.fn(async () => null) },
      issueLocation: { findMany: jest.fn(async () => []) },
      issueComment: { create: jest.fn(async () => ({ id: 1 })) },
    };
    const service: any = new IssuesService(
      prisma,
      { emitIssueUpdated: jest.fn(), emitActivityAdded: jest.fn(), emitCommentAdded: jest.fn() } as any,
      { notifyEmployees: jest.fn(async () => 0), createNotification: jest.fn(async () => ({})) } as any,
      { onIssueStatusChanged: jest.fn() } as any,
    );
    service.stopTimerForEmployee = jest.fn(async () => ({ success: true }));
    jest.spyOn(service, 'assertNotAwaitingApproval').mockResolvedValue(undefined);
    jest.spyOn(service, 'assertMayChange').mockResolvedValue(undefined);
    return service;
  };

  it('stops a running timer when the card goes back to To Do', async () => {
    const service = make(true);
    await service.updateIssue(1, 4, 10, 1, { columnId: 1 }, 'EMPLOYEE');
    expect(service.stopTimerForEmployee).toHaveBeenCalledWith(1, 4, 10, 1);
  });

  it('still stops it on the way to Review', async () => {
    const service = make(true);
    await service.updateIssue(1, 4, 10, 1, { columnId: 3, completionRemark: 'done' }, 'EMPLOYEE');
    expect(service.stopTimerForEmployee).toHaveBeenCalled();
  });

  it('does nothing when no timer is running', async () => {
    const service = make(false);
    await service.updateIssue(1, 4, 10, 1, { columnId: 1 }, 'EMPLOYEE');
    expect(service.stopTimerForEmployee).not.toHaveBeenCalled();
  });
});
