import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectTicketsService } from './project-tickets.service';

/**
 * §30: Ticket → PM estimate → admin approval → task.
 *
 * The approval is the whole feature. A PM can already create a task outright,
 * so what these pin down is that the ticket route cannot be used to slip past
 * the decision — and that approving actually produces the task, rather than
 * leaving an APPROVED row somebody still has to remember to act on.
 */
const TICKET = {
  id: 9,
  projectId: 3,
  status: 'REQUESTED',
  title: 'Add a second firewall pair',
  description: 'Client asked for HA at the Gurgaon site',
  priority: 'HIGH',
  startDate: null,
  dueDate: null,
  estimatedHours: 12,
  proposedAssigneeId: 60,
  raisedById: 70,
  project: { id: 3, key: 'PA2' },
};

function makeService(over: any = {}) {
  const created: any[] = [];
  const prisma: any = {
    project: {
      findUnique: jest.fn().mockResolvedValue({ leadId: 999 }),
      findFirst: jest.fn().mockResolvedValue({ id: 3 }),
    },
    projectMember: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    projectTicket: {
      count: jest.fn().mockResolvedValue(4),
      create: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
      update: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
      findFirst: jest.fn().mockResolvedValue(TICKET),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    board: {
      findFirst: jest.fn().mockResolvedValue({
        id: 1, columns: [{ id: 11, position: 0 }, { id: 12, position: 1 }],
      }),
    },
    issue: {
      count: jest.fn().mockResolvedValue(20),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((a: any) => {
        created.push(a.data);
        return Promise.resolve({ id: 500, ...a.data });
      }),
    },
    $transaction: jest.fn().mockImplementation((fn: any) => fn(prisma)),
    ...over,
  };
  return { service: new ProjectTicketsService(prisma), prisma, created };
}

describe('raising a ticket', () => {
  it('refuses somebody who does not manage the project', async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue({ leadId: 999 });
    prisma.projectMember.findFirst.mockResolvedValue(null);

    await expect(
      service.create(1, 60, 'EMPLOYEE', 3, { title: 'Something' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets the project lead raise one', async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue({ leadId: 70 });
    prisma.projectMember.findFirst.mockResolvedValue(null);

    await expect(
      service.create(1, 70, 'EMPLOYEE', 3, { title: 'Something' }),
    ).resolves.toBeDefined();
  });

  it('insists on a title', async () => {
    const { service } = makeService();
    await expect(service.create(1, 70, 'ADMIN', 3, { title: '  ' })).rejects.toThrow(/needs a title/);
  });

  it('rejects a due date before the start date', async () => {
    const { service } = makeService();
    await expect(
      service.create(1, 70, 'ADMIN', 3, {
        title: 'X', startDate: '2026-09-20', dueDate: '2026-09-10',
      }),
    ).rejects.toThrow(/cannot be before/);
  });

  // The field means "who on this team would do it". A name from outside the
  // project is a promise the PM cannot keep.
  it('refuses a proposed assignee who is not on the project', async () => {
    const { service, prisma } = makeService();
    prisma.project.findUnique.mockResolvedValue({ leadId: 70 });
    prisma.projectMember.findFirst.mockResolvedValue(null);

    await expect(
      service.create(1, 70, 'ADMIN', 3, { title: 'X', proposedAssigneeId: 61 }),
    ).rejects.toThrow(/not a member of this project/);
  });

  it('numbers tickets per company', async () => {
    const { service, prisma } = makeService();
    await service.create(1, 70, 'ADMIN', 3, { title: 'X' });
    expect(prisma.projectTicket.create.mock.calls[0][0].data.ticketNumber).toBe('TKT-0005');
    expect(prisma.projectTicket.count).toHaveBeenCalledWith({ where: { companyId: 1 } });
  });
});

describe('reviewing a ticket', () => {
  it('refuses anyone who is not an administrator', async () => {
    const { service } = makeService();
    await expect(service.review(1, 70, 'EMPLOYEE', 9, 'APPROVED')).rejects.toThrow(ForbiddenException);
  });

  it('requires a reason to reject', async () => {
    const { service } = makeService();
    await expect(service.review(1, 80, 'ADMIN', 9, 'REJECTED', ' ')).rejects.toThrow(/reason is required/);
  });

  it('records a rejection without creating a task', async () => {
    const { service, prisma } = makeService();
    await service.review(1, 80, 'ADMIN', 9, 'REJECTED', 'Out of scope for this phase');

    expect(prisma.issue.create).not.toHaveBeenCalled();
    const data = prisma.projectTicket.update.mock.calls[0][0].data;
    expect(data.status).toBe('REJECTED');
    expect(data.rejectionReason).toBe('Out of scope for this phase');
  });

  /**
   * Approving converts in the same breath. An approved ticket with no task is
   * the failure this flow exists to prevent: the requirement agreed to, and
   * then quietly lost.
   */
  it('creates the task and links it on approval', async () => {
    const { service, prisma, created } = makeService();
    await service.review(1, 80, 'ADMIN', 9, 'APPROVED');

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      title: TICKET.title,
      projectId: 3,
      priority: 'HIGH',
      assigneeId: 60,
      estimatedHours: 12,
      status: 'TODO',
    });

    const data = prisma.projectTicket.update.mock.calls[0][0].data;
    expect(data.status).toBe('CONVERTED');
    expect(data.convertedIssueId).toBe(500);
  });

  /**
   * A task with no columnId exists but renders nowhere: it shows in the list
   * and is invisible on the board. An approved ticket looked exactly like that
   * — converted, linked, and apparently lost.
   */
  it('puts the new task in the board\'s first column', async () => {
    const { service, created } = makeService();
    await service.review(1, 80, 'ADMIN', 9, 'APPROVED');
    expect(created[0].columnId).toBe(11);
  });

  it('places it at the top of that column, as a new task is everywhere else', async () => {
    const { service, prisma, created } = makeService();
    prisma.issue.findFirst.mockResolvedValue({ position: 0 });

    await service.review(1, 80, 'ADMIN', 9, 'APPROVED');

    expect(created[0].position).toBe(-1);
  });

  it('starts at zero in an empty column', async () => {
    const { service, created } = makeService();
    await service.review(1, 80, 'ADMIN', 9, 'APPROVED');
    expect(created[0].position).toBe(0);
  });

  // A project with no board at all must still convert, not throw.
  it('still creates the task when the project has no board', async () => {
    const { service, created } = makeService({
      board: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await service.review(1, 80, 'ADMIN', 9, 'APPROVED');
    expect(created[0].columnId).toBeNull();
  });

  it('continues the project key sequence for the new task', async () => {
    const { service, created } = makeService();
    await service.review(1, 80, 'ADMIN', 9, 'APPROVED');
    expect(created[0].key).toBe('PA2-21');
  });

  it('refuses to review a ticket twice', async () => {
    const { service, prisma } = makeService();
    prisma.projectTicket.findFirst.mockResolvedValue({ ...TICKET, status: 'CONVERTED' });
    await expect(service.review(1, 80, 'ADMIN', 9, 'APPROVED')).rejects.toThrow(/already converted/);
  });

  it('404s on a ticket that is not there', async () => {
    const { service, prisma } = makeService();
    prisma.projectTicket.findFirst.mockResolvedValue(null);
    await expect(service.review(1, 80, 'ADMIN', 9, 'APPROVED')).rejects.toThrow(NotFoundException);
  });
});

describe('editing a ticket', () => {
  // Editing after approval would change what somebody agreed to without their
  // knowing — the approval would still be there, attached to different work.
  it('refuses once the ticket has been reviewed', async () => {
    const { service, prisma } = makeService();
    prisma.projectTicket.findFirst.mockResolvedValue({ ...TICKET, status: 'CONVERTED' });
    await expect(service.update(1, 70, 'ADMIN', 9, { title: 'New' })).rejects.toThrow(
      /already been reviewed/,
    );
  });

  it('carries the PM estimate', async () => {
    const { service, prisma } = makeService();
    await service.update(1, 70, 'ADMIN', 9, { estimatedHours: 16 });
    expect(prisma.projectTicket.update.mock.calls[0][0].data.estimatedHours).toBe(16);
  });

  it('clears the estimate when it is sent empty', async () => {
    const { service, prisma } = makeService();
    await service.update(1, 70, 'ADMIN', 9, { estimatedHours: '' });
    expect(prisma.projectTicket.update.mock.calls[0][0].data.estimatedHours).toBeNull();
  });
});

describe('the task reporting back (§30)', () => {
  const linked = (status: string) => ({
    projectTicket: {
      findUnique: jest.fn().mockResolvedValue({ id: 9, status }),
      update: jest.fn().mockResolvedValue({}),
    },
  });

  it('marks the ticket completed when its task is done', async () => {
    const { service, prisma } = makeService(linked('CONVERTED'));
    await service.onIssueStatusChanged(500, 'DONE');
    expect(prisma.projectTicket.update.mock.calls[0][0].data.status).toBe('COMPLETED');
  });

  // A reopened task must not leave its ticket claiming finished work.
  it('pulls a completed ticket back when the task reopens', async () => {
    const { service, prisma } = makeService(linked('COMPLETED'));
    await service.onIssueStatusChanged(500, 'IN_PROGRESS');
    expect(prisma.projectTicket.update.mock.calls[0][0].data.status).toBe('CONVERTED');
  });

  it('does nothing for a task that was never a ticket', async () => {
    const { service, prisma } = makeService();
    await service.onIssueStatusChanged(501, 'DONE');
    expect(prisma.projectTicket.update).not.toHaveBeenCalled();
  });

  // Bookkeeping must never fail somebody's attempt to close a task.
  it('swallows a failure rather than breaking the status change', async () => {
    const { service } = makeService({
      projectTicket: {
        findUnique: jest.fn().mockRejectedValue(new Error('database is on fire')),
        update: jest.fn(),
      },
    });
    await expect(service.onIssueStatusChanged(500, 'DONE')).resolves.toBeUndefined();
  });
});
