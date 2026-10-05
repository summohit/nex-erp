import { FieldVisitActivationService } from './field-visit-activation.service';

/**
 * Tasks picked off the board stay with the people the board gives them.
 * Approval used to make everyone going a member of every picked task, which
 * put each person on their colleagues' work.
 */
describe('approval and the tasks picked off the board', () => {
  const service = Object.create(FieldVisitActivationService.prototype) as any;
  const tx = () => ({
    issue: { count: jest.fn(async () => 2) },
    issueMember: { createMany: jest.fn() },
  });
  const tasks = [{ issueId: 176 }, { issueId: 170 }, { issueId: null }] as any;

  it('adds nobody to anybody\'s task', async () => {
    const t = tx();
    await service.attachLinkedTasks(t, { id: 17 }, tasks, [1, 2, 3]);
    expect(t.issueMember.createMany).not.toHaveBeenCalled();
  });

  it('reports the picked tasks that belong to someone going', async () => {
    const t = tx();
    expect(await service.attachLinkedTasks(t, { id: 17 }, tasks, [1, 2, 3])).toBe(2);
    expect((t.issue.count.mock.calls as any)[0][0].where).toEqual({
      id: { in: [176, 170] },
      OR: [
        { assigneeId: { in: [1, 2, 3] } },
        { members: { some: { employeeId: { in: [1, 2, 3] } } } },
      ],
    });
  });

  it('has nothing to report with no picked tasks', async () => {
    const t = tx();
    expect(await service.attachLinkedTasks(t, { id: 17 }, [{ issueId: null }], [1])).toBe(0);
    expect(t.issue.count).not.toHaveBeenCalled();
  });
});
