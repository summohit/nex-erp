import { TicketsService } from './tickets.service';

/** In Progress starts the mover's timer; Resolved/Rejected/Closed stops all. */
describe('the ticket timer follows the status', () => {
  let prisma: any, service: TicketsService;

  beforeEach(() => {
    prisma = {
      ticketTimeEntry: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => ({})),
      },
    };
    service = new TicketsService(prisma, {} as any, {} as any);
  });

  it('starts the mover\'s timer on In Progress', async () => {
    const start = jest.spyOn(service, 'startTimer').mockResolvedValue({ stoppedOnOtherTickets: ['TKT-010'] } as any);
    const out = await service.timerFollowsStatus(1, 9, 42, 'IN_PROGRESS');
    expect(start).toHaveBeenCalledWith(1, 9, 42);
    expect(out).toEqual({ started: true, stoppedOnOtherTickets: ['TKT-010'] });
  });

  it('leaves a timer already running here alone', async () => {
    prisma.ticketTimeEntry.findFirst = jest.fn(async () => ({ id: 3 }));
    const start = jest.spyOn(service, 'startTimer');
    expect(await service.timerFollowsStatus(1, 9, 42, 'IN_PROGRESS')).toEqual({ started: false });
    expect(start).not.toHaveBeenCalled();
  });

  it.each(['RESOLVED', 'REJECTED', 'CLOSED'])('stops every running timer on %s, with its real duration', async (status) => {
    const started = new Date(Date.now() - 90_000);
    prisma.ticketTimeEntry.findMany = jest.fn(async () => [
      { id: 1, startTime: started, notes: null },
      { id: 2, startTime: started, notes: 'mine' },
    ]);
    const out = await service.timerFollowsStatus(1, 9, 42, status);
    expect(out).toEqual({ stopped: 2 });
    const first = prisma.ticketTimeEntry.update.mock.calls[0][0].data;
    expect(first.duration).toBeGreaterThanOrEqual(89);
    expect(first.notes).toMatch(new RegExp(status.toLowerCase()));
    expect(prisma.ticketTimeEntry.update.mock.calls[1][0].data.notes).toBe('mine');
  });

  it('does nothing for a move back to Open', async () => {
    expect(await service.timerFollowsStatus(1, 9, 42, 'OPEN')).toBeUndefined();
  });
});
