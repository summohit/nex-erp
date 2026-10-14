import { BadRequestException } from '@nestjs/common';
import { TicketsService } from './tickets.service';

/**
 * Resolving or rejecting a ticket needs a reason.
 *
 * Both end the conversation for whoever raised it; a status change with no
 * explanation leaves them asking how, or why, with nobody to answer.
 */
describe('TicketsService.update — resolving and rejecting', () => {
  const COMPANY = 1;
  const DEV = 30;
  let prisma: any;
  let service: TicketsService;
  let written: any[];

  beforeEach(() => {
    written = [];
    const record = (kind: string) => jest.fn((args: any) => { written.push({ kind, ...args }); return { kind, ...args }; });
    prisma = {
      ticket: {
        findFirst: jest.fn(async () => ({ id: 27, companyId: COMPANY, status: 'OPEN', reporterId: 5, assigneeId: DEV, departmentId: 2 })),
        update: record('ticket'),
      },
      ticketActivity: { create: record('activity') },
      ticketComment: { create: record('comment') },
      ticketAttachment: { create: record('attachment') },
      department: {
        findFirst: jest.fn(async () => ({ id: 3, name: 'HR' })),
        findUnique: jest.fn(async () => ({ name: 'IT' })),
      },
      employee: {
        count: jest.fn(async () => 2),
        findFirst: jest.fn(async () => ({ firstName: 'Mira', lastName: 'Patel' })),
        findMany: jest.fn(async () => [{ id: 44 }, { id: 45 }]),
      },
      $transaction: jest.fn(async (ops: any[]) => ops.map((o) => ({ ...o, ticketNumber: 'TKT-027', title: 'SD WAN' }))),
    };
    service = new TicketsService(prisma, { sendTicketAssignedEmail: jest.fn() } as any, { notifyEmployees: jest.fn(), createNotification: jest.fn() } as any);
    // The dev team may manage tickets; permission is not what is under test.
    (service as any).myPermissions = jest.fn(async () => ({ canManage: true }));
  });

  const move = (status: string, extra: any = {}) =>
    service.update(COMPANY, 27, DEV, { status, ...extra }, { role: 'EMPLOYEE', employeeId: DEV }).catch((e) => e);

  it.each(['RESOLVED', 'REJECTED'])('refuses %s with no reason', async (status) => {
    const err = await move(status);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('treats whitespace as no reason', async () => {
    expect(await move('RESOLVED', { statusReason: '   ' })).toBeInstanceOf(BadRequestException);
  });

  it('says what is needed for each', async () => {
    expect((await move('RESOLVED')).message).toMatch(/how this ticket was resolved/i);
    expect((await move('REJECTED')).message).toMatch(/why this ticket is being rejected/i);
  });

  it('records the reason in the discussion, in the same write as the status', async () => {
    await move('RESOLVED', { statusReason: 'Router delivered and configured on site' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const comment = written.find((w) => w.kind === 'comment');
    expect(comment.data).toMatchObject({ ticketId: 27, authorId: DEV, body: 'Resolved: Router delivered and configured on site' });
  });

  it('attaches the evidence when given', async () => {
    await move('REJECTED', {
      statusReason: 'Duplicate of TKT-019',
      statusAttachment: { fileName: 'proof.png', fileUrl: 'https://cdn/proof.png', fileSize: 1200 },
    });
    const att = written.find((w) => w.kind === 'attachment');
    expect(att.data).toMatchObject({ ticketId: 27, fileName: 'proof.png', fileUrl: 'https://cdn/proof.png', uploadedById: DEV });
  });

  it('does not write the reason fields as ticket columns', async () => {
    await move('RESOLVED', { statusReason: 'Fixed', statusAttachment: { fileUrl: 'u' } });
    const ticket = written.find((w) => w.kind === 'ticket');
    expect(ticket.data.statusReason).toBeUndefined();
    expect(ticket.data.statusAttachment).toBeUndefined();
  });

  // Other moves are unchanged — only the two that end the ticket ask.
  it('needs no reason to move to In Progress', async () => {
    await move('IN_PROGRESS');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(written.find((w) => w.kind === 'comment')).toBeUndefined();
  });

  it('refuses moving to another team without a reason', async () => {
    const err = await service.update(COMPANY, 27, DEV, { departmentId: 3 }, { role: 'EMPLOYEE', employeeId: DEV }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/why this ticket is moving/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('records a team move, reason, and evidence in one transaction', async () => {
    await service.update(COMPANY, 27, DEV, {
      departmentId: 3,
      moveReason: 'This is an employee leave-policy question.',
      attachments: [{ fileName: 'leave-policy.png', fileUrl: 'https://cdn/leave-policy.png', fileSize: 1200 }],
    }, { role: 'EMPLOYEE', employeeId: DEV });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(written.find((w) => w.kind === 'ticket').data).toMatchObject({ departmentId: 3, assigneeId: null });
    expect(written.find((w) => w.kind === 'comment').data.body)
      .toContain('Moved from IT to HR by Mira Patel: This is an employee leave-policy question.');
    expect(written.find((w) => w.kind === 'comment').data.body)
      .toContain('Evidence: leave-policy.png');
    expect(written.find((w) => w.kind === 'attachment').data)
      .toMatchObject({ ticketId: 27, fileName: 'leave-policy.png', uploadedById: DEV });
  });
});
