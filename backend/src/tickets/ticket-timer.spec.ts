import { BadRequestException } from '@nestjs/common';

import { TicketTimerSweepCron } from './ticket-timer-sweep.cron';

/**
 * Ticket timers nobody stops.
 *
 * Found in live data: three timers had been running for 213 hours because
 * nothing ever closed them, and startTimer's "already running" check was scoped
 * to a single ticket, so one person could leave a timer going on every ticket
 * they touched.
 *
 * The property worth protecting is that an auto-closed session never records
 * the wall-clock gap — that is what turns a forgotten timer into nine days of
 * logged work.
 */
describe('TicketTimerSweepCron', () => {
  const HOUR = 3600_000;
  const CAP_HOURS = 8;

  let prisma: any;
  let cron: TicketTimerSweepCron;
  let rows: any[];

  beforeEach(() => {
    rows = [];
    prisma = {
      ticketTimeEntry: {
        findMany: jest.fn(async ({ where }: any) =>
          rows.filter((r) => r.endTime === null && r.startTime < where.startTime.lt),
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const row = rows.find((r) => r.id === where.id);
          Object.assign(row, data);
          return row;
        }),
      },
    };
    cron = new TicketTimerSweepCron(prisma);
  });

  const open = (id: number, hoursAgo: number, notes: string | null = null) => {
    const row: any = { id, startTime: new Date(Date.now() - hoursAgo * HOUR), endTime: null, duration: null, notes };
    rows.push(row);
    return row;
  };

  it('closes a timer left running for days without recording days', async () => {
    const row = open(1, 213);

    const res = await cron.sweepAbandonedTimers();

    expect(res.closed).toBe(1);
    expect(row.duration).toBe(CAP_HOURS * 3600);
    // The end is measured from the START plus the cap — using "now" is exactly
    // what would write 213 hours.
    expect(row.endTime.getTime()).toBe(row.startTime.getTime() + CAP_HOURS * HOUR);
  });

  it('marks what it did, so the figure is never mistaken for a measurement', async () => {
    const row = open(1, 213);
    await cron.sweepAbandonedTimers();
    expect(row.notes).toMatch(/Auto-closed after being left running/);
    expect(row.notes).toMatch(/real duration is unknown/);
  });

  it('keeps any note the user had already written', async () => {
    const row = open(1, 50, 'Investigating the CRM import');
    await cron.sweepAbandonedTimers();
    expect(row.notes).toMatch(/^Investigating the CRM import\n/);
    expect(row.notes).toMatch(/Auto-closed/);
  });

  it("leaves a live session alone", async () => {
    const row = open(1, 2); // someone's afternoon

    const res = await cron.sweepAbandonedTimers();

    expect(res.closed).toBe(0);
    expect(row.endTime).toBeNull();
    expect(prisma.ticketTimeEntry.update).not.toHaveBeenCalled();
  });

  it('leaves a session that is only just short of the cap', async () => {
    open(1, CAP_HOURS - 0.1);
    await expect(cron.sweepAbandonedTimers()).resolves.toEqual({ closed: 0 });
  });

  it('closes several at once and ignores already-closed rows', async () => {
    open(1, 213);
    open(2, 212);
    open(3, 1);
    rows.push({ id: 4, startTime: new Date(Date.now() - 400 * HOUR), endTime: new Date(), duration: 60, notes: null });

    await expect(cron.sweepAbandonedTimers()).resolves.toEqual({ closed: 2 });
  });

  it('does not run twice concurrently', async () => {
    open(1, 213);
    const [a, b] = await Promise.all([cron.sweepAbandonedTimers(), cron.sweepAbandonedTimers()]);
    expect([a.closed, b.closed].sort()).toEqual([0, 1]);
  });
});

/**
 * The other half: one person, one running timer. Nobody works on two tickets at
 * once, and the old per-ticket check let them accumulate.
 */
describe('TicketsService.startTimer', () => {
  const USER = 26;
  let prisma: any;
  let service: any;
  let entries: any[];

  beforeEach(() => {
    entries = [];
    prisma = {
      ticket: { findFirst: jest.fn(async () => ({ id: 1, companyId: 1 })) },
      ticketTimeEntry: {
        findFirst: jest.fn(async ({ where }: any) =>
          entries.find((e) => e.ticketId === where.ticketId && e.userId === where.userId && e.endTime === null) ?? null,
        ),
        findMany: jest.fn(async ({ where }: any) =>
          entries.filter((e) => e.userId === where.userId && e.endTime === null),
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const row = entries.find((e) => e.id === where.id);
          Object.assign(row, data);
          return row;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: entries.length + 100, endTime: null, duration: null, ...data };
          entries.push(row);
          return row;
        }),
      },
    };

    const { TicketsService } = require('./tickets.service');
    service = new TicketsService(prisma, {} as any, {} as any, {} as any);
    service.ensureTicketExists = jest.fn(async () => ({ id: 1 }));
  });

  it('stops the timer running on another ticket, recording its real duration', async () => {
    const startedAt = new Date(Date.now() - 90 * 60_000); // 90 minutes ago
    entries.push({
      id: 4, ticketId: 5, userId: USER, startTime: startedAt, endTime: null,
      duration: null, notes: null, ticket: { ticketNumber: 'TKT-005' },
    });

    const res = await service.startTimer(1, 9, USER);

    const moved = entries.find((e) => e.id === 4);
    expect(moved.endTime).toBeInstanceOf(Date);
    // The real elapsed time, not a cap — this is a deliberate stop, not a sweep.
    expect(moved.duration).toBeGreaterThanOrEqual(5399);
    expect(moved.duration).toBeLessThanOrEqual(5401);
    expect(moved.notes).toMatch(/Stopped automatically/);
    // And the client is told, so the move is not silent.
    expect(res.stoppedOnOtherTickets).toEqual(['TKT-005']);
  });

  it('still refuses a double-start on the same ticket', async () => {
    entries.push({ id: 4, ticketId: 9, userId: USER, startTime: new Date(), endTime: null, ticket: {} });
    await expect(service.startTimer(1, 9, USER)).rejects.toThrow(BadRequestException);
  });

  it('starts cleanly when nothing else is running', async () => {
    const res = await service.startTimer(1, 9, USER);
    expect(res.stoppedOnOtherTickets).toEqual([]);
    expect(prisma.ticketTimeEntry.create).toHaveBeenCalled();
  });
});
