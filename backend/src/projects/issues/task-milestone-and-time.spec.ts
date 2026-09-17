import { BadRequestException } from '@nestjs/common';
import { IssuesService } from './issues.service';

/**
 * Two rules added when milestones got task counts:
 *
 *  - a task may only be attached to a milestone of its OWN project, because
 *    milestone ids are unique company-wide and a mis-attached task would count
 *    toward another project's progress and, later, its billing value;
 *  - logging work moves a task out of To Do, because a task with hours on it
 *    is demonstrably not "to do" — but only ever forwards.
 */
function makeService(over: any = {}) {
  const prisma: any = {
    issue: {
      findUnique: jest.fn().mockResolvedValue({ id: 5, columnId: 10, status: 'TODO' }),
      update: jest.fn().mockResolvedValue({}),
    },
    projectMilestone: { findFirst: jest.fn().mockResolvedValue({ id: 3 }) },
    boardColumn: {
      findUnique: jest.fn().mockResolvedValue({ id: 10, type: 'TODO' }),
      findFirst: jest.fn().mockResolvedValue({ id: 11, type: 'IN_PROGRESS' }),
    },
    issueTimeLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    // §9: manual entry is refused on a project set to timer-only, so every
    // hand-entry path now asks the project first.
    project: {
      findUnique: jest.fn().mockResolvedValue({ allowManualTimeLogging: true, name: 'P' }),
    },
    issueActivity: { create: jest.fn().mockResolvedValue({}) },
    employee: { findFirst: jest.fn().mockResolvedValue({ id: 60 }) },
    ...over,
  };
  return { service: new IssuesService(prisma, {} as any, {} as any), prisma };
}

const call = (service: any, name: string, ...args: any[]) => service[name](...args);

describe('attaching a task to a milestone', () => {
  it('accepts a milestone belonging to the same project', async () => {
    const { service } = makeService();
    await expect(call(service, 'resolveMilestoneId', 1, 2, 3)).resolves.toBe(3);
  });

  it('treats null and empty string as clearing the link', async () => {
    const { service } = makeService();
    await expect(call(service, 'resolveMilestoneId', 1, 2, null)).resolves.toBeNull();
    await expect(call(service, 'resolveMilestoneId', 1, 2, '')).resolves.toBeNull();
    await expect(call(service, 'resolveMilestoneId', 1, 2, undefined)).resolves.toBeNull();
  });

  // The rule that matters: ids are unique company-wide, so without the
  // project check a task could be booked against another project's milestone.
  it('refuses a milestone from another project', async () => {
    const { service, prisma } = makeService();
    prisma.projectMilestone.findFirst.mockResolvedValue(null);

    await expect(call(service, 'resolveMilestoneId', 1, 2, 999)).rejects.toThrow(BadRequestException);
  });

  it('scopes the lookup by both project and company', async () => {
    const { service, prisma } = makeService();
    await call(service, 'resolveMilestoneId', 7, 2, 3);

    expect(prisma.projectMilestone.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3, projectId: 2, companyId: 7 } }),
    );
  });
});

describe('logging work moves a task out of To Do', () => {
  it('promotes a To Do task to the In Progress column', async () => {
    const { service, prisma } = makeService();

    await call(service, 'promoteFromTodoOnWork', 2, { id: 5, columnId: 10, status: 'TODO' });

    expect(prisma.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'IN_PROGRESS', columnId: 11 } }),
    );
  });

  // Retrospective logging is normal. It must not drag finished work backwards.
  it.each([
    ['REVIEW', 'IN_REVIEW'],
    ['DONE', 'DONE'],
    ['IN_PROGRESS', 'IN_PROGRESS'],
  ])('leaves a task in a %s column alone', async (colType, status) => {
    const { service, prisma } = makeService();
    prisma.boardColumn.findUnique.mockResolvedValue({ id: 10, type: colType });

    await call(service, 'promoteFromTodoOnWork', 2, { id: 5, columnId: 10, status });

    expect(prisma.issue.update).not.toHaveBeenCalled();
  });

  it('falls back to the status when the task sits in no column', async () => {
    const { service, prisma } = makeService();

    await call(service, 'promoteFromTodoOnWork', 2, { id: 5, columnId: null, status: 'TODO' });

    expect(prisma.issue.update).toHaveBeenCalled();
  });

  // A board with no In Progress column still gets the status change; silently
  // doing nothing would leave hours on a To Do task.
  it('still sets the status when the board has no In Progress column', async () => {
    const { service, prisma } = makeService();
    prisma.boardColumn.findFirst.mockResolvedValue(null);

    await call(service, 'promoteFromTodoOnWork', 2, { id: 5, columnId: 10, status: 'TODO' });

    expect(prisma.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'IN_PROGRESS' } }),
    );
  });
});

describe('Log Work records manual time as manual', () => {
  // It defaulted to TIMER, which made the weekly timesheet refuse to correct
  // hand-entered time downwards, citing a timer that never ran.
  it('stamps source MANUAL', async () => {
    const { service, prisma } = makeService();

    await service.addManualTimeLog(1, 11, 2, 5, { durationMin: 30 });

    expect(prisma.issueTimeLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: 'MANUAL', durationMin: 30 }) }),
    );
  });

  it('rejects a non-positive duration', async () => {
    const { service } = makeService();
    await expect(service.addManualTimeLog(1, 11, 2, 5, { durationMin: 0 })).rejects.toThrow(BadRequestException);
  });
});

/**
 * §9: the per-project "allow manual time logging" switch.
 *
 * It shipped with the Delivery module's first phase, was written by the project
 * form, and was read by nothing — so a project set to timer-only accepted typed
 * hours anyway. Checked in the service because both the Log Work button and the
 * weekly grid write manual rows, and a rule enforced on one path is not a rule.
 */
describe('manual time entry against a timer-only project', () => {
  const timerOnly = {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        allowManualTimeLogging: false,
        name: 'Pan 2.0_DC_Delhi',
      }),
    },
  };

  it('refuses a hand-entered log, naming the project', async () => {
    const { service } = makeService(timerOnly);
    await expect(
      call(service, 'addManualTimeLog', 1, 2, 3, 5, { durationMin: 60 }),
    ).rejects.toThrow(/Pan 2\.0_DC_Delhi does not allow manual time entry/);
  });

  it('refuses the weekly grid writing the same day', async () => {
    const { service } = makeService(timerOnly);
    await expect(
      call(service, 'setDayTimeTotal', 1, 2, 3, 5, { date: '2026-09-14', durationMin: 60 }),
    ).rejects.toThrow(/does not allow manual time entry/);
  });

  it('still allows it where the project permits', async () => {
    const { service, prisma } = makeService();
    await call(service, 'addManualTimeLog', 1, 2, 3, 5, { durationMin: 60 });
    expect(prisma.issueTimeLog.create).toHaveBeenCalled();
  });
});
