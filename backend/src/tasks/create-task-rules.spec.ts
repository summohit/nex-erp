import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { TasksService } from './tasks.service';

/**
 * What the Add Task form is allowed to send.
 *
 * Three rules, each from a real complaint: the schedule has to make sense, a
 * general task must not demand a project phase, and a refusal has to say what
 * was being attempted — a project manager who is told "you cannot create tasks
 * here" has no way to know that a project task would have been fine.
 */
describe('TasksService.createTask — what it accepts', () => {
  const COMPANY = 1;
  const ME = 42;

  let prisma: any;
  let service: TasksService;

  const valid = (o: Partial<any> = {}) => ({
    title: 'Troubleshoot SAN connectivity',
    parentKind: 'GENERAL' as const,
    startDate: '2026-10-05',
    dueDate: '2026-10-07',
    estimatedHours: 6,
    ...o,
  });

  const create = (data: any, role = 'EMPLOYEE') =>
    service.createTask(COMPANY, ME, role, data);

  beforeEach(() => {
    prisma = {
      project: {
        findFirst: jest.fn(async () => ({ id: 9, key: 'GEN', leadId: null })),
      },
      // No department flag, no PM seat: the person in the screenshot.
      employee: { findFirst: jest.fn(async () => ({ department: { canCreateTasks: false } })) },
      projectMember: { findFirst: jest.fn(async () => null) },
      projectPhase: { count: jest.fn(async () => 3) },
    };
    service = new TasksService(prisma, {} as any, {} as any, {} as any);
  });

  describe('the estimate', () => {
    it.each([undefined, null, '', 0, -2, 'abc'])('refuses %p', async (hours) => {
      await expect(create(valid({ estimatedHours: hours }))).rejects.toThrow(/estimated hours/i);
    });

    // Zero is what people type to get past a required box.
    it('refuses zero specifically', async () => {
      await expect(create(valid({ estimatedHours: 0 }))).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('the dates', () => {
    it('requires a start date', async () => {
      await expect(create(valid({ startDate: undefined }))).rejects.toThrow(/start date/i);
    });

    it('requires a due date', async () => {
      await expect(create(valid({ dueDate: undefined }))).rejects.toThrow(/due date/i);
    });

    it('refuses a due date before the start', async () => {
      await expect(create(valid({ startDate: '2026-10-07', dueDate: '2026-10-05' })))
        .rejects.toThrow(/cannot be before the start date/i);
    });

    // A one-day task starts and finishes on the same day.
    it('accepts the same day for both', async () => {
      // Gets as far as the permission check, which is after validation.
      await expect(create(valid({ startDate: '2026-10-05', dueDate: '2026-10-05' })))
        .rejects.toThrow(/project managers can create general tasks/i);
    });

    it('validates before touching the database', async () => {
      await create(valid({ estimatedHours: 0 })).catch(() => {});
      expect(prisma.project.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('a refusal says what was being attempted', () => {
    it('on a general task, says only admins and PMs may', async () => {
      await expect(create(valid({ parentKind: 'GENERAL' })))
        .rejects.toThrow(/only administrators and project managers can create general tasks/i);
    });

    // The department flag grants project work, not general tasks.
    it('a flagged department alone cannot create a general task', async () => {
      prisma.employee.findFirst = jest.fn(async () => ({ department: { canCreateTasks: true } }));
      await expect(create(valid({ parentKind: 'GENERAL' }))).rejects.toThrow(/project managers/i);
    });

    it('a PM on any project may get past the gate, assigning anyone', async () => {
      prisma.projectMember.findFirst = jest.fn(async () => ({ id: 1 }));
      const err: any = await create(valid({ parentKind: 'GENERAL', assigneeIds: [77, 88] })).catch(e => e);
      expect(String(err?.message)).not.toMatch(/permission|project managers can create/i);
    });

    it('an admin may get past the gate', async () => {
      const err: any = await create(valid({ parentKind: 'GENERAL' }), 'ADMIN').catch(e => e);
      expect(String(err?.message)).not.toMatch(/project managers can create/i);
    });

    it('on a project task, points at the projects they own or manage', async () => {
      prisma.project.findFirst = jest.fn(async () => ({ id: 3, key: 'NEX', leadId: 7 }));
      await expect(create(valid({ parentKind: 'PROJECT', projectId: 3 })))
        .rejects.toThrow(/only raise tasks in projects you own or manage/i);
    });
  });

  // A general task by a PM waits for an administrator; an administrator's
  // own goes straight in.
  describe('approval of a general task', () => {
    const STOP = new Error('stop after create');
    let written: any;

    /**
     * Any model, any call: an empty row (with a key sequence, for the task
     * key) — except issue.create, which records what it was given and stops.
     */
    const anything = (): any => new Proxy({}, {
      get: (_t, model) => model === 'then' ? undefined : new Proxy({}, {
        get: (_m, op) => model === 'issue' && op === 'create'
          ? jest.fn(async (args: any) => { written = args.data; throw STOP; })
          : jest.fn(async () => (op === 'findFirst' ? null : { issueSeq: 1 })),
      }),
    });

    beforeEach(() => {
      written = undefined;
      const tx = anything();
      prisma.$transaction = jest.fn(async (fn: any) => fn(tx));
      prisma.boardColumn = tx.boardColumn;
      prisma.issue = tx.issue;
    });

    it('waits for an administrator when a PM raises it', async () => {
      prisma.projectMember.findFirst = jest.fn(async () => ({ id: 1 }));
      await create(valid({ parentKind: 'GENERAL' })).catch(() => {});
      expect(written).toMatchObject({ approvalState: 'PENDING_ADMIN', approvalRequestedById: ME });
    });

    it.each(['ADMIN', 'SUPERADMIN'])('goes straight in when %s raises it', async (role) => {
      await create(valid({ parentKind: 'GENERAL' }), role).catch(() => {});
      expect(written).toMatchObject({ approvalState: null, approvalRequestedById: null });
    });
  });

  describe('the project phase', () => {
    // The company has active phases (count: 3). A general task must still be
    // creatable — it has no delivery to be in a stage of.
    it('is not demanded of a general task', async () => {
      prisma.projectMember.findFirst = jest.fn(async () => ({ id: 1 }));
      const err: any = await create(valid({ parentKind: 'GENERAL' })).catch(e => e);
      // It may fail later on the mocks, but never for a missing phase.
      expect(String(err?.message)).not.toMatch(/project phase/i);
      expect(prisma.projectPhase.count).not.toHaveBeenCalled();
    });

    it('is still demanded of a project task', async () => {
      prisma.project.findFirst = jest.fn(async () => ({ id: 3, key: 'NEX', leadId: ME }));
      await expect(create(valid({ parentKind: 'PROJECT', projectId: 3 })))
        .rejects.toThrow(/choose the project phase/i);
    });
  });
});
