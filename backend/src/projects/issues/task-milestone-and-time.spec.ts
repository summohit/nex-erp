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
    // §3: every hand-entry path now asks how much has already been logged,
    // to check the write against the task's allowed hours.
    issueTimeLog: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { durationMin: 0 } }),
    },
    // §9: manual entry is refused on a project set to timer-only, so every
    // hand-entry path now asks the project first.
    project: {
      findUnique: jest.fn().mockResolvedValue({ allowManualTimeLogging: true, name: 'P' }),
    },
    issueActivity: { create: jest.fn().mockResolvedValue({}) },
    employee: { findFirst: jest.fn().mockResolvedValue({ id: 60 }) },
    ...over,
  };
  return { service: new IssuesService(prisma, {} as any, {} as any, { onIssueStatusChanged: jest.fn() } as any), prisma };
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

/**
 * §3: the assigned hours are a ceiling, enforced in the service.
 *
 * The arithmetic itself is covered in task-hours.spec.ts. What is pinned here
 * is that the write paths actually consult it — the rule has to hold for
 * anything reaching the API, not just for whatever the form allows.
 */
describe('logging beyond the hours assigned to a task', () => {
  const fullTask = (estimatedHours: number | null, loggedMin: number, additionalHours = 0) => ({
    issue: {
      findUnique: jest.fn().mockResolvedValue({
        id: 5, columnId: 10, status: 'TODO', estimatedHours, additionalHours,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    issueTimeLog: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _sum: { durationMin: loggedMin } }),
    },
  });

  it('refuses a hand-entered log past the assigned hours', async () => {
    const { service } = makeService(fullTask(4, 240));
    await expect(
      call(service, 'addManualTimeLog', 1, 2, 3, 5, { durationMin: 60 }),
    ).rejects.toThrow(/All 4h assigned to this task have been logged/);
  });

  it('refuses a log that would only partly fit', async () => {
    const { service } = makeService(fullTask(4, 180));
    await expect(
      call(service, 'addManualTimeLog', 1, 2, 3, 5, { durationMin: 120 }),
    ).rejects.toThrow(/Only 1h of the 4h/);
  });

  it('allows the log once additional hours have been approved', async () => {
    const { service, prisma } = makeService(fullTask(4, 240, 4));
    await call(service, 'addManualTimeLog', 1, 2, 3, 5, { durationMin: 60 });
    expect(prisma.issueTimeLog.create).toHaveBeenCalled();
  });

  it('leaves a task that was never estimated unbounded', async () => {
    const { service, prisma } = makeService(fullTask(null, 6000));
    await call(service, 'addManualTimeLog', 1, 2, 3, 5, { durationMin: 600 });
    expect(prisma.issueTimeLog.create).toHaveBeenCalled();
  });

  it('refuses the weekly grid the same way', async () => {
    const { service } = makeService(fullTask(4, 240));
    await expect(
      call(service, 'setDayTimeTotal', 1, 2, 3, 5, { date: '2026-09-14', durationMin: 60 }),
    ).rejects.toThrow(/assigned to this task/);
  });

  it('refuses to start the timer with nothing left', async () => {
    const { service } = makeService(fullTask(4, 240));
    await expect(
      call(service, 'startTimeTracking', 1, 2, 3, 5),
    ).rejects.toThrow(/Request additional hours before starting the timer/);
  });

  // Stopping writes down work that has already happened. Refusing it would
  // discard real time and leave the timer with no way to close.
  it('never refuses a timer stop, even past the ceiling', async () => {
    const { service } = makeService(fullTask(4, 600));
    await expect(call(service, 'stopTimeTracking', 1, 2, 3, 5)).resolves.toBeDefined();
  });
});

/**
 * §8: a task's delivery phase.
 *
 * Phases are company-wide master data, so the check that matters is that a
 * task cannot be pinned to another company's phase by guessing an id.
 */
describe('attaching a task to a phase', () => {
  const withPhase = (phase: any) => ({
    projectPhase: { findFirst: jest.fn().mockResolvedValue(phase) },
  });

  it('accepts a phase belonging to the same company', async () => {
    const { service } = makeService(withPhase({ id: 7 }));
    await expect(call(service, 'resolvePhaseId', 1, 7)).resolves.toBe(7);
  });

  it('refuses a phase from another company', async () => {
    const { service } = makeService(withPhase(null));
    await expect(call(service, 'resolvePhaseId', 1, 999)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('treats null, empty string and undefined as no phase', async () => {
    const { service } = makeService(withPhase({ id: 7 }));
    await expect(call(service, 'resolvePhaseId', 1, null)).resolves.toBeNull();
    await expect(call(service, 'resolvePhaseId', 1, '')).resolves.toBeNull();
    await expect(call(service, 'resolvePhaseId', 1, undefined)).resolves.toBeNull();
  });

  it('ignores a non-numeric id rather than throwing', async () => {
    const { service } = makeService(withPhase({ id: 7 }));
    await expect(call(service, 'resolvePhaseId', 1, 'Phase 1')).resolves.toBeNull();
  });

  // Retiring a phase hides it from new work; it must not make the tasks
  // already sitting in it unsaveable.
  it('still accepts an inactive phase on an existing task', async () => {
    const { service } = makeService(withPhase({ id: 7 }));
    await expect(call(service, 'resolvePhaseId', 1, 7)).resolves.toBe(7);
  });
});

/**
 * §3: the hours a task is assigned must survive its creation.
 *
 * createIssue accepted estimatedHours from the board's create form and never
 * wrote it, so a task created with "4h" typed in came out unestimated -- and
 * an unestimated task is unbounded, which meant the hours ceiling silently
 * did not apply to anything raised from the board.
 */
describe('assigned hours at creation', () => {
  /**
   * createIssue touches a lot of tables on its way to the write -- permissions,
   * the key sequence, columns, activity, sockets. Stubbing each one by name
   * makes the test about the plumbing rather than the behaviour, so the whole
   * client is auto-stubbed and only what matters is pinned.
   */
  function capture() {
    const created: any[] = [];

    const model = (overrides: any = {}) =>
      new Proxy(overrides, {
        get: (target, prop: string) =>
          prop in target ? target[prop] : jest.fn().mockResolvedValue(null),
      });

    const prisma: any = new Proxy(
      {
        issue: model({
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation((a: any) => {
            created.push(a.data);
            return Promise.resolve({ id: 9, ...a.data });
          }),
        }),
        project: model({
          findUnique: jest.fn().mockResolvedValue({ allowManualTimeLogging: true, name: 'P', key: 'NEX' }),
          update: jest.fn().mockResolvedValue({ issueSeq: 1, key: 'NEX' }),
        }),
        boardColumn: model({
          findUnique: jest.fn().mockResolvedValue({ id: 10, type: 'TODO' }),
          findFirst: jest.fn().mockResolvedValue({ id: 10, type: 'TODO' }),
        }),
        // Both halves of canCreateTask, simply satisfied.
        projectMember: model({ findFirst: jest.fn().mockResolvedValue({ id: 1 }) }),
        employee: model({
          findFirst: jest.fn().mockResolvedValue({ id: 60, department: { canCreateTasks: true } }),
        }),
      },
      {
        get: (target: any, prop: string) => {
          if (prop in target) return target[prop];
          if (prop === '$transaction') {
            return jest.fn().mockImplementation((fn: any) => fn(prisma));
          }
          return model();
        },
      },
    );

    return { created, prisma };
  }

  const create = async (data: any) => {
    const { created, prisma } = capture();
    const service = new IssuesService(
      prisma, {} as any, {} as any, { onIssueStatusChanged: jest.fn() } as any,
    );
    try {
      await (service as any).createIssue(1, 2, 3, data);
    } catch {
      // createIssue also emits sockets and notifications this test does not
      // stand up. The write is what is under test, and it happens first.
    }
    return created[0];
  };

  it('writes the estimated hours the form sent', async () => {
    expect(await create({ title: 'T', estimatedHours: 4 })).toMatchObject({ estimatedHours: 4 });
  });

  it('leaves it null when the form sent nothing, keeping the task unbounded', async () => {
    expect(await create({ title: 'T' })).toMatchObject({ estimatedHours: null });
  });

  it('treats an empty string as no estimate rather than zero', async () => {
    expect(await create({ title: 'T', estimatedHours: '' })).toMatchObject({ estimatedHours: null });
  });

  it('coerces a numeric string, since a number input yields one', async () => {
    expect(await create({ title: 'T', estimatedHours: '6' })).toMatchObject({ estimatedHours: 6 });
  });

  // The key comes from the project counter, not the row count: `count + 1`
  // reused numbers after a deletion and collided when two creations raced.
  it('issues the key from the project counter', async () => {
    expect(await create({ title: 'T' })).toMatchObject({ key: 'NEX-1' });
  });
});

/**
 * §3: only management may change the hours a task is assigned.
 *
 * The ceiling is worth nothing if the person it constrains can lift it. An
 * employee who retypes ESTIMATED from 2 to 40 never needs to ask for more
 * hours, and the approval flow becomes decoration.
 */
describe('changing the assigned hours', () => {
  const svc = (over: any = {}) => {
    const prisma: any = {
      issue: {
        findUnique: jest.fn().mockResolvedValue({
          id: 5, columnId: 10, status: 'TODO', estimatedHours: 2,
        }),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      project: { findFirst: jest.fn().mockResolvedValue({ leadId: 70 }) },
      projectMember: { findFirst: jest.fn().mockResolvedValue(null) },
      issueActivity: { create: jest.fn().mockResolvedValue({}) },
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 60 }) },
      boardColumn: { findUnique: jest.fn().mockResolvedValue({ id: 10, type: 'TODO' }) },
      ...over,
    };
    // updateIssue emits on the sockets gateway and the notifications service
    // on its way out. Neither is what these tests are about, so any method
    // called on them is a no-op rather than a name to keep in sync.
    const anyMethod = () => new Proxy({}, { get: () => jest.fn() }) as any;

    return new IssuesService(prisma, anyMethod(), anyMethod(), anyMethod());
  };

  const update = (service: any, employeeId: number, role: string | undefined, hours: any) =>
    (service as any).updateIssue(1, employeeId, 3, 5, { estimatedHours: hours }, role);

  it('refuses an ordinary employee raising their own ceiling', async () => {
    await expect(update(svc(), 60, 'EMPLOYEE', 40)).rejects.toThrow(
      /Only the project manager can change the hours/,
    );
  });

  it('points the employee at the request flow instead', async () => {
    await expect(update(svc(), 60, 'EMPLOYEE', 40)).rejects.toThrow(
      /additional-hours request/,
    );
  });

  it('allows the project lead', async () => {
    await expect(update(svc(), 70, 'EMPLOYEE', 40)).resolves.toBeDefined();
  });

  it('allows a project manager who is not the lead', async () => {
    const service = svc({
      projectMember: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    });
    await expect(update(service, 71, 'EMPLOYEE', 40)).resolves.toBeDefined();
  });

  it('allows an administrator', async () => {
    await expect(update(svc(), 99, 'ADMIN', 40)).resolves.toBeDefined();
  });

  // Every other edit on a task sends the whole form back, estimatedHours
  // included. Treating an unchanged value as an attempt to change it would
  // refuse an employee moving their own card.
  it('ignores an unchanged value, so ordinary edits still work', async () => {
    await expect(update(svc(), 60, 'EMPLOYEE', 2)).resolves.toBeDefined();
  });

  it('treats a string of the same number as unchanged', async () => {
    await expect(update(svc(), 60, 'EMPLOYEE', '2')).resolves.toBeDefined();
  });
});

/**
 * The line between doing the work and deciding what the work is.
 *
 * An employee moves their own card, logs time and attaches evidence. Priority,
 * dates, the milestone, who is on it and whether it exists belong to whoever
 * runs the project -- otherwise every constraint on a task can be lifted by
 * the person it constrains.
 */
describe('fields only management may change', () => {
  const svc = (over: any = {}) => {
    const STORED = {
      id: 5, columnId: 10, status: 'TODO', estimatedHours: 2,
      priority: 'MEDIUM', milestoneId: 3, assigneeId: 60,
      title: 'T', description: 'D',
      dueDate: new Date('2026-09-20T00:00:00.000Z'),
    };

    // updateIssue walks a long way past the permission check -- columns,
    // timers, activity, sockets. Only what the rule reads is pinned; the rest
    // auto-stubs, so this stays a test about permissions.
    const model = (o: any = {}) =>
      new Proxy(o, { get: (t, k: string) => (k in t ? t[k] : jest.fn().mockResolvedValue(null)) });

    const prisma: any = new Proxy(
      {
        issue: model({
          findUnique: jest.fn().mockResolvedValue(STORED),
          findUniqueOrThrow: jest.fn().mockResolvedValue(STORED),
          update: jest.fn().mockResolvedValue(STORED),
        }),
        project: model({ findFirst: jest.fn().mockResolvedValue({ leadId: 70 }) }),
        projectMember: model({ findFirst: jest.fn().mockResolvedValue(null) }),
        projectMilestone: model({ findFirst: jest.fn().mockResolvedValue({ id: 9 }) }),
        boardColumn: model({
          findUnique: jest.fn().mockResolvedValue({ id: 10, type: 'TODO' }),
          findFirst: jest.fn().mockResolvedValue({ id: 11, type: 'IN_PROGRESS' }),
        }),
        issueTimeLog: model({
          aggregate: jest.fn().mockResolvedValue({ _sum: { durationMin: 0 } }),
        }),
        employee: model({ findFirst: jest.fn().mockResolvedValue({ id: 60 }) }),
        ...over,
      },
      {
        get: (t: any, k: string) => {
          if (k in t) return t[k];
          if (k === '$transaction') return jest.fn().mockImplementation((fn: any) => fn(prisma));
          return model();
        },
      },
    );

    const anyMethod = () => new Proxy({}, { get: () => jest.fn() }) as any;
    return new IssuesService(prisma, anyMethod(), anyMethod(), anyMethod());
  };

  const asEmployee = (data: any) => (svc() as any).updateIssue(1, 60, 3, 5, data, 'EMPLOYEE');
  const asLead = (data: any) => (svc() as any).updateIssue(1, 70, 3, 5, data, 'EMPLOYEE');

  it.each([
    ['priority', { priority: 'CRITICAL' }, /the priority/],
    ['the due date', { dueDate: '2027-01-01T00:00:00.000Z' }, /the due date/],
    ['the milestone', { milestoneId: 9 }, /the milestone/],
    ['the assignee', { assigneeId: 61 }, /who the task is assigned to/],
  ])('refuses an employee changing %s', async (_label, data, message) => {
    await expect(asEmployee(data)).rejects.toThrow(message);
  });

  it('allows the project lead to change the same field', async () => {
    await expect(asLead({ priority: 'CRITICAL' })).resolves.toBeDefined();
  });

  // Moving your own card IS the work, so the board must keep working.
  it('still lets an employee move their card between columns', async () => {
    await expect(asEmployee({ status: 'IN_PROGRESS' })).resolves.toBeDefined();
  });

  it('still lets an employee reorder their card', async () => {
    await expect(asEmployee({ position: 3 })).resolves.toBeDefined();
  });

  // Every edit posts the whole form back, so an untouched field must not read
  // as an attempt to change it.
  it('ignores fields resubmitted unchanged', async () => {
    await expect(
      asEmployee({ priority: 'MEDIUM', milestoneId: 3, dueDate: '2026-09-20T00:00:00.000Z' }),
    ).resolves.toBeDefined();
  });

  it('treats a numeric id sent as a string as unchanged', async () => {
    await expect(asEmployee({ milestoneId: '3' })).resolves.toBeDefined();
  });
});

/**
 * §8: a new task must belong to a phase.
 *
 * Conditional on the company having any. The rule is about which phase work
 * belongs to, which is meaningless where none exist -- enforcing it there
 * would break the board rather than organise it.
 */
describe('requiring a phase on a new task', () => {
  const svc = (activePhases: number) => {
    const created: any[] = [];
    const model = (o: any = {}) =>
      new Proxy(o, { get: (t, k: string) => (k in t ? t[k] : jest.fn().mockResolvedValue(null)) });

    const prisma: any = new Proxy(
      {
        issue: model({
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation((a: any) => {
            created.push(a.data);
            return Promise.resolve({ id: 9, ...a.data });
          }),
        }),
        projectPhase: model({
          count: jest.fn().mockResolvedValue(activePhases),
          findFirst: jest.fn().mockResolvedValue({ id: 3 }),
        }),
        project: model({
          findUnique: jest.fn().mockResolvedValue({ allowManualTimeLogging: true, name: 'P', key: 'NEX' }),
          update: jest.fn().mockResolvedValue({ issueSeq: 1, key: 'NEX' }),
        }),
        boardColumn: model({
          findUnique: jest.fn().mockResolvedValue({ id: 10, type: 'TODO' }),
          findFirst: jest.fn().mockResolvedValue({ id: 10, type: 'TODO' }),
        }),
        projectMember: model({ findFirst: jest.fn().mockResolvedValue({ id: 1 }) }),
        employee: model({
          findFirst: jest.fn().mockResolvedValue({ id: 60, department: { canCreateTasks: true } }),
        }),
      },
      {
        get: (t: any, k: string) => {
          if (k in t) return t[k];
          if (k === '$transaction') return jest.fn().mockImplementation((fn: any) => fn(prisma));
          return model();
        },
      },
    );

    const anyMethod = () => new Proxy({}, { get: () => jest.fn() }) as any;
    return {
      created,
      service: new IssuesService(prisma, anyMethod(), anyMethod(), anyMethod()),
    };
  };

  const create = (service: any, data: any) => (service as any).createIssue(1, 2, 3, data);

  it('refuses a task raised without one', async () => {
    const { service } = svc(5);
    await expect(create(service, { title: 'T' })).rejects.toThrow(/Choose the project phase/);
  });

  it('accepts one that names a phase', async () => {
    const { service, created } = svc(5);
    try { await create(service, { title: 'T', phaseId: 3 }); } catch { /* sockets */ }
    expect(created[0]).toMatchObject({ phaseId: 3 });
  });

  // A company that has retired every phase must not lose task creation.
  it('does not require one when the company has no active phases', async () => {
    const { service, created } = svc(0);
    try { await create(service, { title: 'T' }); } catch { /* sockets */ }
    expect(created[0]).toMatchObject({ phaseId: null });
  });
});
