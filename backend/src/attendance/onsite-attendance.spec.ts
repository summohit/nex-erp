import { AttendanceService } from './attendance.service';
import { ShiftRosterService } from './shift-roster.service';

/**
 * Clocking on an on-site day. Two behaviours matter here and neither existed
 * before: lateness is judged against the roster's window rather than the office
 * shift, and the branch IP/geofence checks are skipped — someone rostered to a
 * client site is by definition outside the office radius, so enforcing it would
 * make an on-site day impossible to clock at all.
 */
describe('clockIn / clockOut on an on-site day', () => {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  /** A real instant for the given IST wall-clock time on 2026-09-10. */
  const ist = (hh: number, mm = 0) => new Date(Date.UTC(2026, 8, 10, hh, mm) - IST_OFFSET_MS);

  const OFFICE_SHIFT = {
    id: 1, name: 'General Shift', startTime: '09:30', endTime: '18:30',
    bufferTimeMinutes: 15, workingDays: null,
  };
  // A branch with a geofence the employee is nowhere near.
  const BRANCH = {
    name: 'Head Office', latitude: 28.6139, longitude: 77.209,
    geofenceRadius: 200, allowedIps: '10.0.0.1',
  };
  const SITE = { lat: 28.4595, lng: 77.0266, ipAddress: '49.36.1.1' }; // ~40km away

  let prisma: any;
  let roster: any;
  let service: AttendanceService;

  beforeEach(() => {
    prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10, userId: 99, shift: OFFICE_SHIFT, branch: BRANCH,
        }),
      },
      attendance: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ id: 5, ...data, logs: [] })),
        update: jest.fn(async ({ data }: any) => ({ id: 5, ...data, logs: [] })),
      },
      attendanceLog: { create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
    };
    roster = { getEffectiveShift: jest.fn() };
    service = new AttendanceService(prisma, {} as any, roster as ShiftRosterService);
  });

  const onsiteDay = (startTime: string, endTime: string) =>
    roster.getEffectiveShift.mockResolvedValue({
      source: 'ROSTER',
      shift: { id: 2, name: 'On-site Shift', bufferTimeMinutes: 10 },
      startTime, endTime, isDayOff: false,
      onsite: { projectId: 7, address: 'Client site, Gurugram' },
    });

  const officeDay = () =>
    roster.getEffectiveShift.mockResolvedValue({
      source: 'STANDING',
      shift: { id: 1, name: 'General Shift', bufferTimeMinutes: 15 },
      startTime: '09:30', endTime: '18:30', isDayOff: false, onsite: null,
    });

  it('lets an on-site worker clock in far outside the branch geofence', async () => {
    onsiteDay('07:00', '14:00');
    jest.useFakeTimers().setSystemTime(ist(7, 2));

    await expect(service.clockIn(99, SITE)).resolves.toBeDefined();
    expect(prisma.attendance.create).toHaveBeenCalled();
  });

  it('still enforces the branch IP allow-list on a normal office day', async () => {
    officeDay();
    jest.useFakeTimers().setSystemTime(ist(9, 25));

    await expect(service.clockIn(99, SITE)).rejects.toThrow(/not in the allowed list/i);
  });

  it('still enforces the geofence on a normal office day', async () => {
    officeDay();
    jest.useFakeTimers().setSystemTime(ist(9, 25));

    // On the office network but 40km from the office — the geofence is the
    // check that has to catch this, so the IP rule cannot mask it.
    await expect(
      service.clockIn(99, { ...SITE, ipAddress: '10.0.0.1' }),
    ).rejects.toThrow(/clock-in radius/i);
  });

  it('skips the branch IP allow-list on an on-site day', async () => {
    onsiteDay('07:00', '14:00');
    jest.useFakeTimers().setSystemTime(ist(7, 2));

    await expect(service.clockIn(99, SITE)).resolves.toBeDefined();
  });

  it('judges lateness against the on-site window, not the office shift', async () => {
    // 07:05 is five minutes past a 07:00 on-site start but hours before 09:30.
    onsiteDay('07:00', '14:00');
    jest.useFakeTimers().setSystemTime(ist(7, 5));

    await service.clockIn(99, SITE);
    // 07:00 + 10min buffer = 07:10, so 07:05 is on time.
    expect(prisma.attendance.create.mock.calls[0][0].data.isLate).toBe(false);
  });

  it('marks an on-site clock-in late once its own buffer is past', async () => {
    onsiteDay('07:00', '14:00');
    jest.useFakeTimers().setSystemTime(ist(7, 30));

    await service.clockIn(99, SITE);
    expect(prisma.attendance.create.mock.calls[0][0].data.isLate).toBe(true);
  });

  it('records the project and the on-site flag on the attendance row', async () => {
    onsiteDay('07:00', '14:00');
    jest.useFakeTimers().setSystemTime(ist(7, 0));

    await service.clockIn(99, SITE);
    expect(prisma.attendance.create.mock.calls[0][0].data).toMatchObject({
      shiftId: 2, projectId: 7, isOnsite: true,
    });
  });

  it('does not call a 14:00 on-site finish an early leave', async () => {
    onsiteDay('07:00', '14:00');
    jest.useFakeTimers().setSystemTime(ist(14, 5));
    prisma.attendance.findUnique.mockResolvedValue({
      id: 5, clockIn: ist(7, 0), status: 'PRESENT',
      logs: [{ id: 100, clockIn: ist(7, 0), clockOut: null }],
    });

    await service.clockOut(99, { lat: SITE.lat, lng: SITE.lng });
    const data = prisma.attendance.update.mock.calls[0][0].data;
    expect(data.isEarlyLeave).toBe(false);
    expect(data.status).toBe('PRESENT');
  });

  it('would have called that same finish an early leave under the office shift', async () => {
    // The regression this feature exists to fix: without the roster, 14:05 is
    // four hours short of the 18:30 office end and scores as a half day.
    officeDay();
    jest.useFakeTimers().setSystemTime(ist(14, 5));
    prisma.attendance.findUnique.mockResolvedValue({
      id: 5, clockIn: ist(7, 0), status: 'PRESENT',
      logs: [{ id: 100, clockIn: ist(7, 0), clockOut: null }],
    });

    await service.clockOut(99, { lat: BRANCH.latitude, lng: BRANCH.longitude });
    const data = prisma.attendance.update.mock.calls[0][0].data;
    expect(data.isEarlyLeave).toBe(true);
    expect(data.status).toBe('HALF_DAY');
  });

  afterEach(() => jest.useRealTimers());
});
