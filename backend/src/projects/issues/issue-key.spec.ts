import { IssuesService } from './issues.service';

/**
 * Task keys come from the project's own counter.
 *
 * `${count + 1}` looked right until two creations landed in the same second,
 * or a task was deleted: concurrent callers collided on the unique index, and
 * a deletion shrank the count so the next task reused a number already in use.
 * Project.issueSeq is a column, so incrementing it row-locks the project and
 * hands every creator a number nobody else can receive.
 */
describe('allocating a task key', () => {
  function make(seqAfterIncrement: number) {
    const tx: any = {
      project: {
        update: jest.fn().mockResolvedValue({ issueSeq: seqAfterIncrement }),
      },
      issue: {
        findFirst: jest.fn().mockResolvedValue({ position: 0 }),
        create: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 9, ...a.data })),
      },
      issueActivity: {
        create: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 1, ...a.data })),
      },
      board: { findFirst: jest.fn().mockResolvedValue({ id: 5, columns: [{ id: 10, name: 'To Do', type: 'TODO', position: 0 }] }) },
      projectPhase: { count: jest.fn().mockResolvedValue(0) },
      projectMember: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 60, department: { canCreateTasks: true } }),
      },
      boardColumn: { findUnique: jest.fn().mockResolvedValue({ id: 10, type: 'TODO', name: 'To Do' }) },
    };
    const prisma: any = {
      ...tx,
      project: {
        ...tx.project,
        findUnique: jest.fn().mockResolvedValue({ id: 3, key: 'NEX', companyId: 1, leadId: 60 }),
        findFirst: jest.fn().mockResolvedValue({ id: 3, key: 'NEX', companyId: 1, leadId: 60 }),
      },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };
    const service = new IssuesService(
      prisma, { emitIssueUpdated: jest.fn(), emitActivityAdded: jest.fn() } as any,
      {} as any, { onIssueStatusChanged: jest.fn() } as any,
    );
    return { service, prisma, tx };
  }

  it('numbers the task from the counter, not from how many exist', async () => {
    const { service, tx } = make(11);
    await (service as any).createIssue(1, 60, 3, { title: 'T' }).catch(() => {});

    // Ten tasks with NEX-5 deleted still yields NEX-11, because the counter
    // only ever goes up.
    expect(tx.issue.create.mock.calls[0][0].data.key).toBe('NEX-11');
  });

  it('takes the number inside the same transaction as the write', async () => {
    const { service, prisma, tx } = make(4);
    await (service as any).createIssue(1, 60, 3, { title: 'T' }).catch(() => {});

    expect(prisma.$transaction).toHaveBeenCalled();
    // The increment and the insert share one transaction, so no second
    // creator can be handed the same number in between.
    expect(tx.project.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { issueSeq: { increment: 1 } },
    }));
  });
});
