import { AttendanceService } from './attendance.service';
import { ShiftRosterService } from './shift-roster.service';

/**
 * B1: working a holiday is recorded and nothing more — no late mark, no half
 * day, no early leave, no overtime. Nobody was expected in.
 */
describe('clockIn / clockOut on a holiday', () => {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  /** A real instant for an IST wall-clock time on 2026-10-02 (Gandhi Jayanti). */
  const ist = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 2, hh, mm) - IST_OFFSET_MS);
  const DAY_KEY = new Date(Date.UTC(2026, 9, 2));

  let prisma: any;
  let service: AttendanceService;
  let holidayToday: boolean;

  beforeEach(() => {
    holidayToday = true;
    prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10, userId: 99, companyId: 1,
          shift: { id: 1, name: 'General Shift' }, branch: null,
        }),
      },
      attendance: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ id: 5, ...data, logs: [] })),
        update: jest.fn(async ({ data }: any) => ({ id: 5, ...data, logs: [] })),
      },
      attendanceLog: { create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
      holiday: { findFirst: jest.fn(async () => (holidayToday ? { id: 9 } : null)) },
      fieldVisitAttendance: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const roster = {
      getEffectiveShift: jest.fn().mockResolvedValue({
        source: 'STANDING',
        shift: { id: 1, name: 'General Shift', bufferTimeMinutes: 15, halfDayTime: '13:30' },
        startTime: '09:30', endTime: '18:30', isDayOff: false, onsite: null,
      }),
    };
    service = new AttendanceService(prisma, {} as any, roster as unknown as ShiftRosterService, {} as any);
  });

  afterEach(() => jest.useRealTimers());

  it('does not mark a late or half-day clock-in on a holiday', async () => {
    jest.useFakeTimers().setSystemTime(ist(14, 0)); // past both the buffer and half-day time

    await service.clockIn(99, {});

    const data = prisma.attendance.create.mock.calls[0][0].data;
    expect(data.isLate).toBe(false);
    expect(data.status).toBe('PRESENT');
  });

  it('still marks late on an ordinary day', async () => {
    holidayToday = false;
    jest.useFakeTimers().setSystemTime(ist(11, 0));

    await service.clockIn(99, {});

    expect(prisma.attendance.create.mock.calls[0][0].data.isLate).toBe(true);
  });

  it('looks the holiday up by the attendance day', async () => {
    jest.useFakeTimers().setSystemTime(ist(10, 0));

    await service.clockIn(99, {});

    const where = prisma.holiday.findFirst.mock.calls[0][0].where;
    expect(where.companyId).toBe(1);
    expect(where.date.gte.toISOString()).toBe(DAY_KEY.toISOString());
  });

  it('records no early leave and no overtime on a holiday clock-out', async () => {
    const open = { id: 5, date: DAY_KEY, clockIn: ist(10, 0), status: 'PRESENT', isEarlyLeave: false, logs: [{ id: 1, clockOut: null }] };
    prisma.attendance.findUnique.mockResolvedValue(open);
    jest.useFakeTimers().setSystemTime(ist(12, 0)); // hours before the 18:30 end

    await service.clockOut(99, {});

    const data = prisma.attendance.update.mock.calls.at(-1)[0].data;
    expect(data.isEarlyLeave).toBeFalsy();
    expect(data.status).not.toBe('HALF_DAY');
    expect(data.overtimeHours ?? 0).toBe(0);
  });
});
