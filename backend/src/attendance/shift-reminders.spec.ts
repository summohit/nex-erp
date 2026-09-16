import { ShiftRemindersCron } from './shift-reminders.cron';

/**
 * Who gets a shift reminder, and when.
 *
 * The two things worth guarding are the ones a reader cannot verify by eye: the
 * sweep must not send to somebody with no shift (the whole feature is opt-in by
 * virtue of having a roster), and it must not send the same reminder twice when
 * a tick is late, the process restarts, or a second instance is running.
 */
describe('ShiftRemindersCron', () => {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = (hh: number, mm = 0) => new Date(Date.UTC(2026, 8, 16, hh, mm) - IST_OFFSET_MS);
  const DAY_KEY = new Date(Date.UTC(2026, 8, 16));

  const NINE_THIRTY = { startTime: '09:30', endTime: '18:30', isDayOff: false, shift: { id: 1 } };

  let prisma: any;
  let roster: any;
  let notifications: any;
  let cron: ShiftRemindersCron;
  /** Employees the roster will answer for, keyed by id. */
  let windows: Map<number, any>;

  beforeEach(() => {
    windows = new Map([[10, { ...NINE_THIRTY }]]);
    prisma = {
      employee: {
        findMany: jest.fn(async () => [{ id: 10 }]),
        findUnique: jest.fn(async () => ({ userId: 99, companyId: 1 })),
      },
      shiftRosterEntry: { findMany: jest.fn(async () => []) },
      attendance: { findMany: jest.fn(async () => []) },
      shiftReminderLog: { create: jest.fn(async () => ({ id: 1 })) },
    };
    roster = { getEffectiveShiftsForDate: jest.fn(async () => windows) };
    notifications = { createNotification: jest.fn(async () => ({})) };
    cron = new ShiftRemindersCron(prisma, roster, notifications);
  });

  const sentKinds = () =>
    prisma.shiftReminderLog.create.mock.calls.map((c: any[]) => c[0].data.kind);
  const messages = () =>
    notifications.createNotification.mock.calls.map((c: any[]) => c[2]);

  describe('the clock-in ladder', () => {
    it.each([
      [ist(9, 20), 'CLOCK_IN_T10'],
      [ist(9, 25), 'CLOCK_IN_T5'],
      [ist(9, 29), 'CLOCK_IN_T1'],
    ])('fires at %s', async (now, kind) => {
      await cron.run(now as Date);
      expect(sentKinds()).toEqual([kind]);
    });

    it('is silent at a minute that is not a reminder', async () => {
      await cron.run(ist(9, 15));
      expect(prisma.shiftReminderLog.create).not.toHaveBeenCalled();
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('the clock-out ladder', () => {
    beforeEach(() => {
      // Clock-out reminders only mean anything to someone who is clocked in.
      prisma.attendance.findMany = jest.fn(async () => [
        { employeeId: 10, clockIn: ist(9, 30), clockOut: null },
      ]);
    });

    it.each([
      [ist(18, 20), 'CLOCK_OUT_T10'],
      [ist(18, 25), 'CLOCK_OUT_T5'],
      [ist(18, 40), 'CLOCK_OUT_OVERDUE'],
    ])('fires at %s', async (now, kind) => {
      await cron.run(now as Date);
      expect(sentKinds()).toEqual([kind]);
    });
  });

  describe('people with nothing to be reminded about', () => {
    it('sends nothing when the day is a day off', async () => {
      windows.set(10, { ...NINE_THIRTY, isDayOff: true });
      await cron.run(ist(9, 20));
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    // A duration-only shift has no boundary to be ten minutes away from. This
    // is also how "no shift assigned" is enforced — there is no window, so
    // there is nothing to fire against, rather than a separate check.
    it('sends nothing for a shift with no start or end time', async () => {
      windows.set(10, { startTime: null, endTime: null, isDayOff: false, shift: { id: 1 } });
      await cron.run(ist(9, 20));
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('does not even look up a shift when nobody has one', async () => {
      prisma.employee.findMany = jest.fn(async () => []);
      await cron.run(ist(9, 20));
      expect(roster.getEffectiveShiftsForDate).not.toHaveBeenCalled();
    });
  });

  describe('suppression once the person has acted', () => {
    it('stops telling someone to clock in after they have clocked in', async () => {
      prisma.attendance.findMany = jest.fn(async () => [
        { employeeId: 10, clockIn: ist(9, 5), clockOut: null },
      ]);
      await cron.run(ist(9, 25));
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('stops telling someone to clock out after they have clocked out', async () => {
      prisma.attendance.findMany = jest.fn(async () => [
        { employeeId: 10, clockIn: ist(9, 30), clockOut: ist(18, 15) },
      ]);
      await cron.run(ist(18, 25));
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    // Someone who never clocked in has nothing to clock out of; the missed
    // clock-out sweep is not this job's concern.
    it('does not tell someone to clock out who never clocked in', async () => {
      prisma.attendance.findMany = jest.fn(async () => []);
      await cron.run(ist(18, 25));
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('sending exactly once', () => {
    /**
     * The claim is written before the send. A unique-constraint failure means
     * another tick — or another backend instance — already owns this reminder.
     */
    it('does not notify when the claim is already taken', async () => {
      prisma.shiftReminderLog.create = jest.fn(async () => {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      });
      await cron.run(ist(9, 20));
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('claims before it notifies, never after', async () => {
      const order: string[] = [];
      prisma.shiftReminderLog.create = jest.fn(async () => { order.push('claim'); return { id: 1 }; });
      notifications.createNotification = jest.fn(async () => { order.push('notify'); });
      await cron.run(ist(9, 20));
      expect(order).toEqual(['claim', 'notify']);
    });

    // A tick that lands a minute late must still fire rather than lose the
    // reminder entirely — the claim row is what stops that becoming a double.
    it('still fires one minute late', async () => {
      await cron.run(ist(9, 21));
      expect(sentKinds()).toEqual(['CLOCK_IN_T10']);
    });

    it('has given up by the time it is three minutes late', async () => {
      await cron.run(ist(9, 23));
      expect(prisma.shiftReminderLog.create).not.toHaveBeenCalled();
    });
  });

  it('logs the reminder against the shift’s own IST day', async () => {
    await cron.run(ist(9, 20));
    expect(prisma.shiftReminderLog.create.mock.calls[0][0].data.date).toEqual(DAY_KEY);
  });

  // A muted reminder is a missed shift. ACTION_REQUIRED is the one type
  // NotificationsService refuses to suppress.
  it('sends as ACTION_REQUIRED so it cannot be muted', async () => {
    await cron.run(ist(9, 20));
    expect(notifications.createNotification.mock.calls[0][3]).toBe('ACTION_REQUIRED');
  });

  it('uses the wording from the specification', async () => {
    await cron.run(ist(9, 25));
    expect(messages()[0]).toBe('Your shift starts in 5 minutes. Please clock in.');
  });

  /**
   * A shift that starts just after midnight has its 10-minute warning at 23:50
   * the previous evening. The offset arithmetic wraps rather than going
   * negative, so the reminder still fires.
   */
  it('handles a shift starting just after midnight', async () => {
    windows.set(10, { startTime: '00:05', endTime: '08:05', isDayOff: false, shift: { id: 1 } });
    await cron.run(ist(23, 55));
    expect(sentKinds()).toEqual(['CLOCK_IN_T10']);
  });
});
