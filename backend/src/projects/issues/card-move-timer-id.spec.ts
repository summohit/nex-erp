import { IssuesService } from './issues.service';

/**
 * Moving a card to In Progress auto-starts its timer. updateIssue holds an
 * EMPLOYEE id and used to hand it to startTimeTracking, whose parameter is a
 * USER id -- so the resolver looked up `employee where userId = <employee id>`.
 *
 * For the 95 of 98 accounts whose two ids coincide that silently worked. For
 * Richard Roe (user 103, employee 99) it found nothing and the whole card move
 * failed with 404 "No employee profile for this user".
 */
function makeService() {
  const prisma: any = {
    issue: {
      findUnique: jest.fn().mockResolvedValue({ id: 11, status: 'TODO', columnId: 1 }),
    },
    // Only ever finds Richard BY USER ID 103, never by 99.
    employee: {
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where?.userId === 103 ? { id: 99 } : null),
      ),
    },
  };
  const service: any = new IssuesService(prisma, {} as any, {} as any, {} as any);
  return { service, prisma };
}

describe('the timer knows which id it was handed', () => {
  it('resolves a USER id on the HTTP entry point', async () => {
    const { service } = makeService();
    service.startTimerForEmployee = jest.fn().mockResolvedValue({ ok: true });

    await service.startTimeTracking(1, 103, 7, 11);

    // Resolved 103 -> 99 before handing the timer an employee id.
    expect(service.startTimerForEmployee).toHaveBeenCalledWith(1, 99, 7, 11);
  });

  it('refuses a user id that has no employee', async () => {
    const { service } = makeService();
    service.startTimerForEmployee = jest.fn();

    await expect(service.startTimeTracking(1, 999, 7, 11)).rejects.toThrow(
      'No employee profile for this user',
    );
  });

  it('takes an EMPLOYEE id directly, without a user lookup', async () => {
    // The path a card move uses. Passing 99 here must NOT be resolved again --
    // that second resolution is exactly what produced the 404.
    const { service, prisma } = makeService();

    await service.startTimerForEmployee(1, 99, 7, 11).catch(() => {});

    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
  });
});
