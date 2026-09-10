import { AutoClockoutCron } from './auto-clockout.cron';

/**
 * The startup sweep runs unconditionally on every process boot, so with
 * `nest start --watch` it fires on each file save. It must therefore never
 * close a session that is still legitimately open.
 */
describe('AutoClockoutCron', () => {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

  /** A Date for the given IST wall-clock time, on 2026-09-09 unless told otherwise. */
  const ist = (hh: number, mm = 0, day = 9) =>
    new Date(Date.UTC(2026, 8, day, hh, mm) - IST_OFFSET_MS);

  let prisma: any;
  let roster: any;
  let cron: AutoClockoutCron;

  const openSessionAt = (clockInIstHour: number, day = 9) => {
    // The clock-in has to fall on the session's own day, or the "never write a
    // clock-out earlier than the clock-in" rule legitimately pushes the cutoff.
    const clockIn = ist(clockInIstHour, 0, day);
    return {
      id: 1,
      employeeId: 10,
      date: new Date(Date.UTC(2026, 8, day)),
      clockIn,
      clockOut: null,
      clockInLat: 28.4,
      clockInLng: 77.4,
      status: 'PRESENT',
      logs: [{ id: 100, clockIn, clockOut: null, clockInLat: 28.4, clockInLng: 77.4 }],
      employee: { shift: { endTime: '18:00' } },
    };
  };

  beforeEach(() => {
    prisma = {
      attendance: { findMany: jest.fn(), update: jest.fn(async () => ({})) },
      attendanceLog: { update: jest.fn(async () => ({})) },
    };
    // Stands in for the real resolver: with no roster entry it hands back the
    // standing shift's window, which is what every fixture here expects.
    roster = {
      getEffectiveShift: jest.fn(async (_empId: number, _date: Date, standing: any) => ({
        source: standing ? 'STANDING' : 'NONE',
        shift: standing ? { id: 1, name: 'General', bufferTimeMinutes: 15 } : null,
        startTime: standing?.startTime ?? null,
        endTime: standing?.endTime ?? null,
        isDayOff: false,
        onsite: null,
      })),
    };
    cron = new AutoClockoutCron(prisma, roster as any);
  });

  afterEach(() => jest.useRealTimers());

  it('leaves a live session open when the 23:00 cutoff has not arrived', async () => {
    jest.useFakeTimers().setSystemTime(ist(14, 34)); // mid-afternoon restart
    prisma.attendance.findMany.mockResolvedValue([openSessionAt(14)]);

    await cron.autoClockOutOpenSessions();

    // The regression: this used to clamp the cutoff to "now" and end the
    // workday of everyone who happened to be clocked in during a deploy.
    expect(prisma.attendance.update).not.toHaveBeenCalled();
    expect(prisma.attendanceLog.update).not.toHaveBeenCalled();
  });

  it('closes a session once 23:00 IST has passed', async () => {
    jest.useFakeTimers().setSystemTime(ist(23, 5));
    prisma.attendance.findMany.mockResolvedValue([openSessionAt(9)]);

    await cron.autoClockOutOpenSessions();

    expect(prisma.attendance.update).toHaveBeenCalledTimes(1);
    const written = prisma.attendance.update.mock.calls[0][0].data;
    // Closed at 23:00 of its own day, not at the moment the sweep ran.
    expect(new Date(written.clockOut).toISOString()).toBe(ist(23, 0).toISOString());
  });

  it("closes yesterday's forgotten session at yesterday's 23:00", async () => {
    jest.useFakeTimers().setSystemTime(ist(10)); // next morning
    prisma.attendance.findMany.mockResolvedValue([openSessionAt(9, 8)]);

    await cron.autoClockOutOpenSessions();

    expect(prisma.attendance.update).toHaveBeenCalledTimes(1);
    const written = prisma.attendance.update.mock.calls[0][0].data;
    // A session left open for days must not record a multi-day shift.
    expect(new Date(written.clockOut).toISOString())
      .toBe(new Date(Date.UTC(2026, 8, 8, 23, 0) - IST_OFFSET_MS).toISOString());
  });

  it('closes the open logs alongside the attendance row', async () => {
    jest.useFakeTimers().setSystemTime(ist(23, 5));
    prisma.attendance.findMany.mockResolvedValue([openSessionAt(9)]);

    await cron.autoClockOutOpenSessions();

    expect(prisma.attendanceLog.update).toHaveBeenCalledTimes(1);
  });
});
