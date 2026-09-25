import { AttendanceService } from './attendance.service';
import { ShiftRosterService } from './shift-roster.service';

/**
 * The office clock-in is the bypass, and this is the test that holds it shut.
 *
 * Approving a field visit writes a roster entry marking the day on-site, and
 * an on-site day is exempt from the branch IP check and the branch geofence —
 * by design, since a client site is nowhere near the office. Left alone, that
 * exemption means anyone on a field visit could clock the day from their sofa
 * through the ordinary attendance screen, and the 500m rule would be
 * decorative. So the ordinary clock refuses a field visit day outright and
 * sends them to the screen that measures them.
 */
describe('the ordinary clock on a field visit day', () => {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = (hh: number, mm = 0) => new Date(Date.UTC(2026, 8, 24, hh, mm) - IST_OFFSET_MS);

  const BRANCH = {
    name: 'Head Office', latitude: 28.6139, longitude: 77.209,
    geofenceRadius: 200, allowedIps: '10.0.0.1',
  };
  /** Nowhere near the office — where the bypass would have been used from. */
  const SOFA = { lat: 28.4595, lng: 77.0266, ipAddress: '49.36.1.1' };

  const FIELD_VISIT_DAY = {
    request: { requestNumber: 'FVR-0009', location: 'Client Site – Delhi' },
  };

  let prisma: any;
  let roster: any;
  let service: AttendanceService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(ist(10, 0));
    prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10, userId: 99,
          shift: { id: 1, name: 'General', startTime: '09:30', endTime: '18:30', bufferTimeMinutes: 15 },
          branch: BRANCH,
        }),
      },
      attendance: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ id: 5, ...data, logs: [] })),
        update: jest.fn(async ({ data }: any) => ({ id: 5, ...data, logs: [] })),
      },
      attendanceLog: { create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
      fieldVisitAttendance: { findFirst: jest.fn().mockResolvedValue(FIELD_VISIT_DAY) },
    };
    // The roster says on-site, exactly as approval left it.
    roster = {
      getEffectiveShift: jest.fn().mockResolvedValue({
        source: 'ROSTER',
        shift: { id: 2, name: 'On-site', bufferTimeMinutes: 10 },
        startTime: '09:00', endTime: '18:00', isDayOff: false,
        onsite: { projectId: 3, address: 'Client Site – Delhi' },
      }),
    };
    service = new AttendanceService(prisma, {} as any, roster as ShiftRosterService);
  });

  afterEach(() => jest.useRealTimers());

  it('refuses an office clock-in from 40km away, and says where to go instead', async () => {
    await expect(service.clockIn(99, SOFA)).rejects.toThrow(
      /You are on field visit FVR-0009 at Client Site – Delhi today\. Clock in from the Field Visit screen/,
    );
    expect(prisma.attendance.create).not.toHaveBeenCalled();
  });

  it('refuses the office clock-out the same way', async () => {
    await expect(service.clockOut(99, SOFA)).rejects.toThrow(/Clock out from the Field Visit screen/);
  });

  it('only asks about the day being clocked', async () => {
    await expect(service.clockIn(99, SOFA)).rejects.toThrow();
    expect(prisma.fieldVisitAttendance.findFirst.mock.calls[0][0].where).toMatchObject({
      employeeId: 10,
      visitDate: new Date(Date.UTC(2026, 8, 24)),
      request: { status: 'APPROVED' },
    });
  });

  it('lets the field visit screen through, and marks the day on-site against the project', async () => {
    const context = { fieldVisit: { requestId: 9, requestNumber: 'FVR-0009', projectId: 3 } };
    await service.clockIn(99, SOFA, context);

    const written = prisma.attendance.create.mock.calls[0][0].data;
    expect(written.isOnsite).toBe(true);
    expect(written.projectId).toBe(3);
  });

  it('treats a field visit clock-in as on-site even if the roster entry has gone', async () => {
    // Someone edited the roster after approval. The trip is still approved and
    // the site check has already been made, so the office geofence must not be
    // the thing that refuses them at the client site.
    roster.getEffectiveShift.mockResolvedValue({
      source: 'STANDING',
      shift: { id: 1, name: 'General', bufferTimeMinutes: 15 },
      startTime: '09:30', endTime: '18:30', isDayOff: false, onsite: null,
    });

    const context = { fieldVisit: { requestId: 9, requestNumber: 'FVR-0009', projectId: 3 } };
    await expect(service.clockIn(99, SOFA, context)).resolves.toBeDefined();
    expect(prisma.attendance.create.mock.calls[0][0].data.projectId).toBe(3);
  });

  it('leaves an ordinary office day alone', async () => {
    prisma.fieldVisitAttendance.findFirst.mockResolvedValue(null);
    roster.getEffectiveShift.mockResolvedValue({
      source: 'STANDING',
      shift: { id: 1, name: 'General', bufferTimeMinutes: 15 },
      startTime: '09:30', endTime: '18:30', isDayOff: false, onsite: null,
    });

    // Still refused, but by the branch rules that were already there — the IP
    // allow-list is the first of them, which is why it and not the geofence is
    // what answers here.
    await expect(service.clockIn(99, SOFA)).rejects.toThrow(/IP Address .* is not in the allowed list/);

    // And with the office IP, by the geofence behind it.
    await expect(service.clockIn(99, { ...SOFA, ipAddress: '10.0.0.1' }))
      .rejects.toThrow(/outside the .* clock-in radius/);
  });
});
