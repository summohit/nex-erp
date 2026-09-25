import { BadRequestException } from '@nestjs/common';
import { FieldVisitClockService } from './field-visit-clock.service';

/**
 * §6: 500 metres from the approved site, and not a metre further.
 *
 * The distances below are real: the site is the spec's own Delhi coordinate,
 * and each "employee at N metres" is that point moved due north by N metres,
 * so the haversine under test is doing the arithmetic rather than a fixture.
 */

const SITE = { lat: 28.6139, lng: 77.209 };

/**
 * A point `metres` due north of the site.
 *
 * Metres per degree of latitude is derived from the same earth radius the
 * haversine under test uses (6371 km), so "500m away" here is 500m there.
 * Borrowing the round 111,320 figure instead puts the boundary case 0.6m out,
 * which is the difference between testing the rule and testing a constant.
 */
const METRES_PER_DEGREE = (6371 * 1000 * Math.PI) / 180;

function north(metres: number) {
  return { lat: SITE.lat + metres / METRES_PER_DEGREE, lng: SITE.lng };
}

const REQUEST = {
  id: 9, requestNumber: 'FVR-0009', status: 'APPROVED',
  location: 'Client Site – Delhi',
  latitude: SITE.lat, longitude: SITE.lng, geofenceRadiusM: 500,
  startTime: '09:00', endTime: '18:00',
  project: { id: 3, name: 'Acme Rollout', key: 'ACME' },
};

const DAY = {
  id: 44, visitDate: new Date('2026-09-24T00:00:00.000Z'), isHoliday: false,
  status: 'SCHEDULED', clockInTime: null, clockOutTime: null,
  clockInDistanceKm: null, clockOutDistanceKm: null,
  issue: null, request: REQUEST,
};

function makeService(over: any = {}) {
  const prisma: any = {
    employee: { findUnique: jest.fn().mockResolvedValue({ id: 60, companyId: 1 }) },
    fieldVisitAttendance: {
      findMany: jest.fn().mockResolvedValue([DAY]),
      update: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 44, ...a.data })),
    },
    issue: {
      findMany: jest.fn().mockResolvedValue([{ id: 501 }, { id: 502 }]),
    },
    ...over,
  };
  const attendance: any = {
    clockIn: jest.fn().mockResolvedValue({ id: 1 }),
    clockOut: jest.fn().mockResolvedValue({ id: 1 }),
  };
  return { service: new FieldVisitClockService(prisma, attendance), prisma, attendance };
}

describe('the 500 metre rule', () => {
  it.each([
    ['at the site', 0],
    ['100m away', 100],
    ['350m away', 350],
    ['exactly 500m away', 500],
  ])('lets somebody clock in %s', async (_label, metres) => {
    const { service, prisma } = makeService();
    await service.clockIn(7, { issueId: 501, ...north(metres) });

    const written = prisma.fieldVisitAttendance.update.mock.calls[0][0].data;
    expect(written.status).toBe('IN_PROGRESS');
    expect(Math.round(written.clockInDistanceKm * 1000)).toBe(metres);
  });

  it('refuses somebody 650m away, in the words the spec asks for', async () => {
    const { service, prisma, attendance } = makeService();

    await expect(service.clockIn(7, { issueId: 501, ...north(650) })).rejects.toThrow(
      /You are outside the approved Field Visit location\. Please move within 500 metres of the site to Clock In\/Clock Out\./,
    );
    // Nothing happened: no attendance record, no half-clocked day.
    expect(attendance.clockIn).not.toHaveBeenCalled();
    expect(prisma.fieldVisitAttendance.update).not.toHaveBeenCalled();
  });

  it('says how far off they actually are, so the number is arguable', async () => {
    const { service } = makeService();
    await expect(service.clockIn(7, { issueId: 501, ...north(650) }))
      .rejects.toThrow(/You are 650m from Client Site – Delhi/);
  });

  it('honours a radius other than the default when the request carries one', async () => {
    const { service } = makeService({
      fieldVisitAttendance: {
        findMany: jest.fn().mockResolvedValue([
          { ...DAY, request: { ...REQUEST, geofenceRadiusM: 200 } },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    await expect(service.clockIn(7, { issueId: 501, ...north(350) }))
      .rejects.toThrow(/within 200 metres/);
  });

  it('applies the same radius on a company holiday (§8)', async () => {
    const { service, prisma } = makeService({
      fieldVisitAttendance: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ ...DAY, isHoliday: true }])
          // The same day once it has been clocked into, which is what the
          // clock-out below reads.
          .mockResolvedValue([{
            ...DAY, isHoliday: true, status: 'IN_PROGRESS',
            clockInTime: new Date('2026-09-24T03:35:00.000Z'),
          }]),
        update: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 44, ...a.data })),
      },
      issue: { findMany: jest.fn().mockResolvedValue([{ id: 501 }]) },
    });

    // The visit stays active on the holiday and nobody files leave for it, so
    // the day is clocked like any other — and refused from outside like any
    // other.
    await service.clockIn(7, { issueId: 501, ...north(120) });
    expect(prisma.fieldVisitAttendance.update.mock.calls[0][0].data.status).toBe('IN_PROGRESS');

    await expect(service.clockOut(7, { ...north(700) }))
      .rejects.toThrow(/outside the approved Field Visit location/);
  });

  it('refuses a clock-in with no location at all', async () => {
    const { service } = makeService();
    await expect(service.clockIn(7, { issueId: 501 }))
      .rejects.toThrow(/location is required/i);
  });

  it('measures the way out too — leaving the site does not close the day', async () => {
    const { service, attendance } = makeService({
      fieldVisitAttendance: {
        findMany: jest.fn().mockResolvedValue([
          { ...DAY, clockInTime: new Date('2026-09-24T03:35:00.000Z'), status: 'IN_PROGRESS' },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    await expect(service.clockOut(7, { ...north(900) }))
      .rejects.toThrow(/outside the approved Field Visit location/);
    expect(attendance.clockOut).not.toHaveBeenCalled();
  });
});

describe('the day and the task', () => {
  it('records the day against the task the employee picked', async () => {
    const { service, prisma } = makeService();
    await service.clockIn(7, { issueId: 502, ...north(10) });
    expect(prisma.fieldVisitAttendance.update.mock.calls[0][0].data.issueId).toBe(502);
  });

  it('will not clock in without a task when tasks were assigned', async () => {
    const { service } = makeService();
    await expect(service.clockIn(7, { ...north(10) }))
      .rejects.toThrow(/Pick the task you are clocking in for/);
  });

  it('refuses a task belonging to somebody else on the trip', async () => {
    const { service } = makeService();
    await expect(service.clockIn(7, { issueId: 999, ...north(10) }))
      .rejects.toThrow(/not one of yours/);
  });

  it('still clocks a trip whose tasks have all been archived', async () => {
    const { service, prisma } = makeService({ issue: { findMany: jest.fn().mockResolvedValue([]) } });
    await service.clockIn(7, { ...north(10) });
    expect(prisma.fieldVisitAttendance.update.mock.calls[0][0].data.issueId).toBeNull();
  });

  it('refuses when today is not a day of an approved visit', async () => {
    const { service } = makeService({
      fieldVisitAttendance: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    });
    await expect(service.clockIn(7, { issueId: 501, ...north(10) }))
      .rejects.toThrow(/not scheduled on an approved field visit today/);
  });

  it('refuses to guess which trip when somebody is on two in one day', async () => {
    const { service } = makeService({
      fieldVisitAttendance: {
        findMany: jest.fn().mockResolvedValue([
          DAY,
          { ...DAY, id: 45, request: { ...REQUEST, id: 10, requestNumber: 'FVR-0010' } },
        ]),
        update: jest.fn(),
      },
    });
    await expect(service.clockIn(7, { issueId: 501, ...north(10) }))
      .rejects.toThrow(/FVR-0009, FVR-0010.*say which one/s);
  });

  it('refuses a second clock-in on a day already clocked', async () => {
    const { service } = makeService({
      fieldVisitAttendance: {
        findMany: jest.fn().mockResolvedValue([
          { ...DAY, clockInTime: new Date('2026-09-24T03:35:00.000Z') },
        ]),
        update: jest.fn(),
      },
    });
    await expect(service.clockIn(7, { issueId: 501, ...north(10) }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a clock-out before a clock-in', async () => {
    const { service } = makeService();
    await expect(service.clockOut(7, { ...north(10) }))
      .rejects.toThrow(/have not clocked into this field visit/);
  });
});

describe('the attendance record behind it', () => {
  it('delegates the attendance itself, flagged as a field visit', async () => {
    const { service, attendance } = makeService();
    await service.clockIn(7, { issueId: 501, ...north(10), ipAddress: '10.0.0.9' });

    expect(attendance.clockIn).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ ipAddress: '10.0.0.9' }),
      { fieldVisit: { requestId: 9, requestNumber: 'FVR-0009', projectId: 3 } },
    );
  });

  it('leaves the day untouched when attendance refuses the clock-in', async () => {
    const { service, prisma, attendance } = makeService();
    // An abandoned session from an earlier day is the usual reason.
    attendance.clockIn.mockRejectedValue(new BadRequestException('Close Monday first'));

    await expect(service.clockIn(7, { issueId: 501, ...north(10) })).rejects.toThrow('Close Monday first');
    expect(prisma.fieldVisitAttendance.update).not.toHaveBeenCalled();
  });
});
