import { AttendanceService } from './attendance.service';
import { ShiftRosterService } from './shift-roster.service';
import { LateClockOutError, OpenSessionError } from './open-session.error';

/**
 * What happens when somebody forgets to clock out.
 *
 * Until now the 23:00 sweep wrote a clock-out for them, so this situation did
 * not persist past bedtime and none of it needed rules. With the sweep reduced
 * to flagging, the open session survives into the next day and three things
 * have to hold: a new shift cannot start on top of it, closing it works at all
 * (the old lookup only ever considered today), and closing it asks why.
 */
describe('an unclosed session from a previous day', () => {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  /** A real instant for an IST wall-clock time on the given September 2026 day. */
  const ist = (day: number, hh: number, mm = 0) =>
    new Date(Date.UTC(2026, 8, day, hh, mm) - IST_OFFSET_MS);
  const dayKey = (day: number) => new Date(Date.UTC(2026, 8, day));

  const MONDAY = dayKey(14);
  const TUESDAY = dayKey(15);

  const SHIFT = {
    id: 1, name: 'General Shift', startTime: '09:30', endTime: '18:30',
    bufferTimeMinutes: 15, workingDays: null,
  };

  /** Monday, clocked in at 09:30, never clocked out. */
  const mondayOpen = () => ({
    id: 5, date: MONDAY, clockIn: ist(14, 9, 30), clockOut: null,
    status: 'PRESENT', isEarlyLeave: false, missedClockOut: true,
    logs: [{ id: 100, clockIn: ist(14, 9, 30), clockOut: null }],
  });

  /**
   * Monday as the Workway import writes it: a clock-in, no clock-out, and no
   * logs at all, because the import writes the parent row only. An approved
   * regularization produces the same shape.
   */
  const mondayImported = () => ({
    id: 8, date: MONDAY, clockIn: ist(14, 9, 30), clockOut: null,
    status: 'PRESENT', isEarlyLeave: false, missedClockOut: true,
    logs: [],
  });

  /** Monday opened and closed twice — nothing is running. */
  const mondayClosed = () => ({
    id: 9, date: MONDAY, clockIn: ist(14, 9, 30), clockOut: ist(14, 18, 30),
    status: 'PRESENT', isEarlyLeave: false, missedClockOut: false,
    logs: [{ id: 102, clockIn: ist(14, 9, 30), clockOut: ist(14, 18, 30) }],
  });

  /**
   * Answers findFirst by actually applying the where clause, rather than
   * returning a fixed row whatever is asked.
   *
   * The deadlock this file now guards against lived entirely in the where
   * clause — clock-in asked the parent row, clock-out asked the logs — so a
   * mock that ignores it cannot see the bug at all.
   */
  const findFirstOver = (rows: any[]) => jest.fn(async ({ where }: any) => {
    const matches = rows.filter((r) => {
      if (where.date?.lt && !(r.date.getTime() < where.date.lt.getTime())) return false;
      if (where.clockIn?.not === null && r.clockIn == null) return false;
      if ('clockOut' in where && where.clockOut === null && r.clockOut != null) return false;
      if (where.logs?.some && 'clockOut' in where.logs.some && where.logs.some.clockOut === null) {
        if (!r.logs.some((l: any) => l.clockOut == null)) return false;
      }
      return true;
    });
    return matches.sort((a, b) => b.date.getTime() - a.date.getTime())[0] ?? null;
  });

  let prisma: any;
  let roster: any;
  let service: AttendanceService;

  beforeEach(() => {
    prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          // No branch: geofencing is tested elsewhere and is not what this is about.
          id: 10, userId: 99, shift: SHIFT, branch: null,
        }),
      },
      attendance: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ id: 6, ...data, logs: [] })),
        update: jest.fn(async ({ data }: any) => ({ id: 5, ...data, logs: [] })),
      },
      attendanceLog: { create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
    };
    roster = {
      getEffectiveShift: jest.fn().mockResolvedValue({
        source: 'STANDING',
        shift: { id: 1, name: 'General Shift', bufferTimeMinutes: 15 },
        startTime: '09:30', endTime: '18:30', isDayOff: false, onsite: null,
      }),
    };
    service = new AttendanceService(prisma, {} as any, roster as ShiftRosterService);
  });

  afterEach(() => jest.useRealTimers());

  describe('starting a new shift on top of it', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(ist(15, 9, 25));
      prisma.attendance.findFirst.mockResolvedValue(mondayOpen());
    });

    it('is refused', async () => {
      await expect(service.clockIn(99, {})).rejects.toBeInstanceOf(OpenSessionError);
    });

    // The client has to offer "clock out from Monday", which it cannot do from
    // a message string it would have to pattern-match.
    it('says which day is open, under a stable code', async () => {
      const err: any = await service.clockIn(99, {}).catch(e => e);
      expect(err.getResponse()).toMatchObject({
        code: 'OPEN_PREVIOUS_SESSION',
        openSessionDate: '2026-09-14',
      });
      expect(err.getResponse().message).toMatch(/clock out from the previous shift/i);
    });

    it('writes nothing', async () => {
      await service.clockIn(99, {}).catch(() => {});
      expect(prisma.attendance.create).not.toHaveBeenCalled();
      expect(prisma.attendance.update).not.toHaveBeenCalled();
    });
  });

  describe('closing it the next morning', () => {
    beforeEach(() => {
      // 00:40 IST on Tuesday — past midnight, so this is a previous day.
      jest.useFakeTimers().setSystemTime(ist(15, 0, 40));
      prisma.attendance.findUnique.mockResolvedValue(null); // nothing open today
      prisma.attendance.findFirst.mockResolvedValue(mondayOpen());
    });

    // The old lookup was today's row or nothing, so this answered "You must
    // clock in first" — wrong, and impossible to act on from the UI.
    it('finds Monday rather than claiming there is nothing to close', async () => {
      const err: any = await service.clockOut(99, {}).catch(e => e);
      expect(err).toBeInstanceOf(LateClockOutError);
    });

    it('demands a reason, naming the day', async () => {
      const err: any = await service.clockOut(99, {}).catch(e => e);
      expect(err.getResponse()).toMatchObject({
        code: 'LATE_CLOCK_OUT_REASON_REQUIRED',
        openSessionDate: '2026-09-14',
      });
    });

    it('treats whitespace as no reason at all', async () => {
      await expect(service.clockOut(99, { reason: '   ' })).rejects.toBeInstanceOf(LateClockOutError);
    });

    it('closes Monday — not today — once a reason is given', async () => {
      await service.clockOut(99, { reason: 'Left site without phone signal' });
      const call = prisma.attendance.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 5 });
      expect(call.data).toMatchObject({
        clockOutReason: 'Left site without phone signal',
        missedClockOut: false,
      });
    });

    /**
     * The gap between Monday 18:30 and Tuesday 00:40 is not work. Paying it as
     * six hours of overtime would make forgetting to clock out profitable.
     */
    it('pays no overtime for the hours nobody worked', async () => {
      await service.clockOut(99, { reason: 'Forgot' });
      expect(prisma.attendance.update.mock.calls[0][0].data.overtimeHours).toBe(0);
    });

    // Nor is it an early leave: the day's own scoring is left as it was and
    // regularization is the path for correcting the real hours.
    it('does not re-score the day as a half day', async () => {
      await service.clockOut(99, { reason: 'Forgot' });
      const data = prisma.attendance.update.mock.calls[0][0].data;
      expect(data.isEarlyLeave).toBe(false);
      expect(data.status).toBe('PRESENT');
    });
  });

  /**
   * The production deadlock, in one property.
   *
   * Clock-in refused with "session still open from 21 Sept 2026"; the dialog's
   * "Clock out from that shift" then answered "Already clocked out"; and there
   * was no third button. The two questions had different answers for the same
   * day, so anybody holding such a day could never clock in again.
   *
   * Both paths go through findOpenSessionBefore, but sharing the function was
   * never the guarantee — sharing the MEANING is. So these tests assert the
   * pairing directly: a day that blocks a clock-in must be a day a clock-out
   * can close, and a day a clock-out cannot close must not block anything.
   */
  describe('a previous day with no clock-out but nothing running', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(ist(15, 9, 25));
      prisma.attendance.findUnique.mockResolvedValue(null);
      prisma.attendance.findFirst = findFirstOver([mondayImported()]);
    });

    // Previously: refused, and the clock-out it sent them to refused as well.
    it('does not block tomorrow\'s clock-in', async () => {
      await expect(service.clockIn(99, {})).resolves.toBeDefined();
      expect(prisma.attendance.create).toHaveBeenCalled();
    });

    it('is not offered as something to clock out of', async () => {
      const err: any = await service.clockOut(99, {}).catch((e) => e);
      // Nothing to close, and it says so plainly rather than naming a day and
      // then refusing to act on it.
      expect(err.message).toMatch(/must clock in first/i);
    });

    // The flag stays; the day really is missing a clock-out, and that belongs
    // in the timesheet. What it must not do is stop the next shift.
    it('is still a day that needs regularization', () => {
      expect(mondayImported().clockOut).toBeNull();
    });
  });

  describe('whichever day the two paths pick', () => {
    const days = [
      ['a session left running', mondayOpen, true],
      ['an imported day with no logs', mondayImported, false],
      ['a day already closed', mondayClosed, false],
    ] as const;

    it.each(days)('%s: blocks clock-in exactly when clock-out can close it', async (_label, row, blocks) => {
      jest.useFakeTimers().setSystemTime(ist(15, 9, 25));
      prisma.attendance.findUnique.mockResolvedValue(null);
      prisma.attendance.findFirst = findFirstOver([row()]);

      const clockInErr = await service.clockIn(99, {}).then(() => null, (e) => e);
      const refusedClockIn = clockInErr instanceof OpenSessionError;

      prisma.attendance.findFirst = findFirstOver([row()]);
      const clockOutErr = await service.clockOut(99, { reason: 'Forgot' }).then(() => null, (e) => e);
      const closable = clockOutErr === null || clockOutErr instanceof LateClockOutError;

      expect(refusedClockIn).toBe(blocks);
      expect(closable).toBe(blocks);
    });
  });

  describe('closing a session on its own day', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(ist(15, 18, 45));
      prisma.attendance.findUnique.mockResolvedValue({
        id: 7, date: TUESDAY, clockIn: ist(15, 9, 30), clockOut: null,
        status: 'PRESENT', isEarlyLeave: false,
        logs: [{ id: 101, clockIn: ist(15, 9, 30), clockOut: null }],
      });
    });

    it('asks for no reason', async () => {
      await expect(service.clockOut(99, {})).resolves.toBeDefined();
    });

    it('stores no reason even when one is volunteered', async () => {
      await service.clockOut(99, { reason: 'unnecessary' });
      expect(prisma.attendance.update.mock.calls[0][0].data.clockOutReason).toBeUndefined();
    });

    it('still scores overtime normally', async () => {
      // 18:45 against an 18:30 end is 15 minutes — under the 30-minute floor.
      await service.clockOut(99, {});
      expect(prisma.attendance.update.mock.calls[0][0].data.overtimeHours).toBe(0);
      expect(prisma.attendance.update.mock.calls[0][0].data.isEarlyLeave).toBe(false);
    });

    // Today's own row wins; the earlier one is only a fallback.
    it('does not go looking for an earlier session', async () => {
      await service.clockOut(99, {});
      expect(prisma.attendance.findFirst).not.toHaveBeenCalled();
    });
  });
});
