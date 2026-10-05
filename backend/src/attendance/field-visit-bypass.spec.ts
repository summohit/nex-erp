import { AttendanceService } from './attendance.service';
import { ShiftRosterService } from './shift-roster.service';

/**
 * A field visit day may be clocked from the ordinary attendance screen
 * (TKT-029). Late and half-day are measured against the visit's own hours,
 * which the approval wrote onto the roster, and the visit's day record is
 * kept in step with where the person actually was.
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
    id: 7, request: { latitude: 28.6, longitude: 77.2 },
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
      holiday: { findFirst: jest.fn(async () => null) },
      fieldVisitAttendance: {
        findFirst: jest.fn().mockResolvedValue(FIELD_VISIT_DAY),
        update: jest.fn(async () => ({})),
      },
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
    service = new AttendanceService(prisma, {} as any, roster as ShiftRosterService, {} as any);
  });

  afterEach(() => jest.useRealTimers());

  it('lets the ordinary clock-in through, late against the visit hours, and opens the visit day', async () => {
    // 10:00 against a 09:00 visit start with a 10 minute buffer.
    await service.clockIn(99, SOFA);

    const written = prisma.attendance.create.mock.calls[0][0].data;
    expect(written.isLate).toBe(true);
    expect(written.isOnsite).toBe(true);
    expect(written.projectId).toBe(3);

    const visit = prisma.fieldVisitAttendance.update.mock.calls[0][0];
    expect(visit.where).toEqual({ id: 7 });
    expect(visit.data.status).toBe('IN_PROGRESS');
    expect(visit.data.clockInDistanceKm).toBeGreaterThan(10);
  });

  it('is not late when clocking in within the visit start', async () => {
    jest.setSystemTime(ist(9, 5));
    await service.clockIn(99, SOFA);
    expect(prisma.attendance.create.mock.calls[0][0].data.isLate).toBe(false);
  });

  it('only looks at the day being clocked that has not been opened yet', async () => {
    await service.clockIn(99, SOFA);
    expect(prisma.fieldVisitAttendance.findFirst.mock.calls[0][0].where).toMatchObject({
      employeeId: 10,
      visitDate: new Date(Date.UTC(2026, 8, 24)),
      clockInTime: null,
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
      shift: { id: 1, name: 'General', bufferTimeMinutes: 15, officeGeofence: true },
      startTime: '09:30', endTime: '18:30', isDayOff: false, onsite: null,
    });

    // Still refused, but by the branch rules that were already there — the IP
    // allow-list is the first of them, which is why it and not the geofence is
    // what answers here.
    await expect(service.clockIn(99, SOFA)).rejects.toThrow(/IP Address .* is not in the allowed list/);

    // And with the office IP, by the geofence behind it.
    await expect(service.clockIn(99, { ...SOFA, ipAddress: '10.0.0.1' }))
      .rejects.toThrow(/outside the .* office radius/);
  });
});
