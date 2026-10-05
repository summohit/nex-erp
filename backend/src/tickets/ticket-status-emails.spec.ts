import { TicketsService } from './tickets.service';

/**
 * Who is emailed when a ticket moves. Resolved asks the reporter to verify and
 * close it; the person who made the change is never emailed about it.
 */
describe('ticket status emails', () => {
  const REPORTER = 1, ASSIGNEE = 2, ADMIN = 3;
  let prisma: any, mail: any, service: TicketsService;

  const updated = { id: 9, ticketNumber: 'TKT-029', title: 'Clock-out blocked', priority: 'HIGH', reporterId: REPORTER, assigneeId: ASSIGNEE, reporter: { firstName: 'Gaurav', lastName: 'Nogia' } };
  const emailOf = (id: number) => ({ id, firstName: `P${id}`, user: { email: `p${id}@x.com` } });

  beforeEach(() => {
    prisma = {
      employee: {
        findMany: jest.fn(async ({ where }: any) => where.id.in.map(emailOf)),
        findFirst: jest.fn(async () => ({ firstName: 'Mohit', lastName: 'Singh' })),
      },
    };
    mail = { sendTicketEmail: jest.fn(async () => undefined) };
    service = new TicketsService(prisma, mail, {} as any);
  });

  const move = (from: string, to: string, actor: number, reason = '') =>
    (service as any).emailStatusChange({ status: from, reporterId: REPORTER, assigneeId: ASSIGNEE }, updated, actor, to, reason);
  const sent = () => mail.sendTicketEmail.mock.calls.map((c: any[]) => [c[0], c[1].kind]);

  it('asks the reporter to verify and close when resolved, with the notes', async () => {
    await move('IN_PROGRESS', 'RESOLVED', ASSIGNEE, '<p>Restarted the <b>service</b></p>');
    expect(sent()).toEqual([['p1@x.com', 'RESOLVED']]);
    expect(mail.sendTicketEmail.mock.calls[0][1]).toMatchObject({ ticketId: 9, note: 'Restarted the service', actorName: 'Mohit Singh' });
  });

  it('tells the reporter when rejected', async () => {
    await move('OPEN', 'REJECTED', ADMIN, 'Duplicate of TKT-010');
    expect(sent()).toEqual([['p1@x.com', 'REJECTED']]);
  });

  it('tells the assignee when the reporter closes it, but not the reporter', async () => {
    await move('RESOLVED', 'CLOSED', REPORTER);
    expect(sent()).toEqual([['p2@x.com', 'CLOSED']]);
  });

  it('tells both sides when somebody else closes it', async () => {
    await move('RESOLVED', 'CLOSED', ADMIN);
    expect(sent().map((x: any[]) => x[0]).sort()).toEqual(['p1@x.com', 'p2@x.com']);
  });

  it('tells the assignee when a closed ticket is reopened', async () => {
    await move('CLOSED', 'OPEN', REPORTER);
    expect(sent()).toEqual([['p2@x.com', 'REOPENED']]);
  });

  it('sends nothing for an ordinary move', async () => {
    await move('OPEN', 'IN_PROGRESS', ASSIGNEE);
    expect(mail.sendTicketEmail).not.toHaveBeenCalled();
  });
});
