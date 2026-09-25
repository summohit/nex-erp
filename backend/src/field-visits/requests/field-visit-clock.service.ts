import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceService } from '../../attendance/attendance.service';
import { haversineKm } from '../../common/geo.util';
import { istDateKey } from '../../common/timezone.util';
import { FIELD_VISIT_STATUS, FIELD_VISIT_DAY } from '../field-visit-status';

export interface ClockData {
  /** Which trip, when somebody is on more than one today. */
  requestId?: number;
  /** The task being clocked against (§5). */
  issueId?: number;
  lat?: number;
  lng?: number;
  ipAddress?: string;
  /** Only read when closing a previous day's session. */
  reason?: string;
}

/**
 * Clocking a day of an approved field visit (§5, §6).
 *
 * The rule this exists for: a clock-in counts only from within 500 metres of
 * the site the request was approved for. The radius lives on the request, so
 * the distance a day was judged against stays readable afterwards, and the
 * measured distance is stored whether or not it passed — a marginal clock-in
 * should stay arguable rather than be reduced to a yes.
 *
 * Attendance itself is not re-implemented here. The ordinary clock-in already
 * owns open sessions, lateness, half days and the attendance log, and a second
 * implementation of those rules for field days would be a second set of
 * answers. This validates the site and the task, delegates the attendance, and
 * then records what the day looked like from the site.
 */
@Injectable()
export class FieldVisitClockService {
  constructor(
    private prisma: PrismaService,
    private attendance: AttendanceService,
  ) {}

  private readonly DAY_SELECT = {
    id: true, visitDate: true, isHoliday: true, status: true,
    clockInTime: true, clockInDistanceKm: true,
    clockOutTime: true, clockOutDistanceKm: true,
    issue: { select: { id: true, key: true, title: true } },
    request: {
      select: {
        id: true, requestNumber: true, status: true,
        location: true, latitude: true, longitude: true, geofenceRadiusM: true,
        startTime: true, endTime: true,
        project: { select: { id: true, name: true, key: true } },
      },
    },
  } as const;

  private async employeeOf(userId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId }, select: { id: true, companyId: true },
    });
    if (!employee) throw new NotFoundException('Employee profile not found');
    return employee;
  }

  /**
   * Today's field visit, with the tasks this person may clock against.
   *
   * What the Field Visit screen opens onto: everything needed to show where to
   * be, how far away that is, and which task to pick — without a clock-in
   * having to be attempted to find out.
   */
  async today(userId: number) {
    const employee = await this.employeeOf(userId);
    const days = await this.prisma.fieldVisitAttendance.findMany({
      where: {
        employeeId: employee.id,
        visitDate: istDateKey(new Date()),
        request: { status: FIELD_VISIT_STATUS.APPROVED },
      },
      select: this.DAY_SELECT,
    });

    return Promise.all(days.map(async (day) => ({
      ...day,
      tasks: await this.prisma.issue.findMany({
        where: {
          fieldVisitRequestId: day.request.id,
          assigneeId: employee.id,
          isArchived: false,
        },
        select: { id: true, key: true, title: true, status: true },
        orderBy: [{ position: 'asc' }],
      }),
    })));
  }

  // ─── The 500 metres ────────────────────────────────────────────────────────

  /**
   * How far off the site they are, refusing anything beyond the radius (§6).
   *
   * Rounded to the nearest metre before the comparison so that exactly 500 m
   * is inside, as the spec says it is, rather than turned away by the last
   * bits of a floating-point division.
   */
  private measureFromSite(request: any, lat?: number, lng?: number): number {
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('Your location is required to clock in or out of a field visit.');
    }

    const distanceKm = haversineKm(request.latitude, request.longitude, lat, lng);
    const distanceM = Math.round(distanceKm * 1000);
    const radiusM = request.geofenceRadiusM ?? 500;

    if (distanceM > radiusM) {
      throw new BadRequestException(
        `You are outside the approved Field Visit location. Please move within ${radiusM} metres`
        + ` of the site to Clock In/Clock Out. You are ${this.spokenDistance(distanceM)} from ${request.location}.`,
      );
    }
    return distanceKm;
  }

  private spokenDistance(metres: number): string {
    return metres >= 1000 ? `${(metres / 1000).toFixed(1)}km` : `${metres}m`;
  }

  // ─── Finding the day ───────────────────────────────────────────────────────

  private async dayForToday(employeeId: number, requestId?: number) {
    const days = await this.prisma.fieldVisitAttendance.findMany({
      where: {
        employeeId,
        visitDate: istDateKey(new Date()),
        request: {
          status: FIELD_VISIT_STATUS.APPROVED,
          ...(requestId ? { id: Number(requestId) } : {}),
        },
      },
      select: this.DAY_SELECT,
    });

    if (!days.length) {
      throw new BadRequestException(
        'You are not scheduled on an approved field visit today.',
      );
    }
    // Two trips on one day is a mistake somebody has to resolve, but it must
    // not be resolved here by picking one: the clock-in would land on whichever
    // the database returned first.
    if (days.length > 1) {
      throw new BadRequestException(
        `You are scheduled on ${days.length} field visits today`
        + ` (${days.map((d) => d.request.requestNumber).join(', ')}) — say which one you are clocking into.`,
      );
    }
    return days[0];
  }

  /**
   * The task they said they were there to do (§5).
   *
   * Required when approval actually gave them one, which after §4 it always
   * does. Left optional otherwise rather than refusing the clock-in: a trip
   * whose tasks were archived is still a day somebody worked.
   */
  private async resolveTask(
    requestId: number, employeeId: number, issueId?: number,
  ): Promise<number | null> {
    const assigned = await this.prisma.issue.findMany({
      where: { fieldVisitRequestId: requestId, assigneeId: employeeId, isArchived: false },
      select: { id: true },
    });
    if (!assigned.length) return null;

    if (issueId == null) {
      throw new BadRequestException('Pick the task you are clocking in for.');
    }
    if (!assigned.some((i) => i.id === Number(issueId))) {
      throw new BadRequestException('That task is not one of yours on this field visit.');
    }
    return Number(issueId);
  }

  // ─── Clocking ──────────────────────────────────────────────────────────────

  async clockIn(userId: number, data: ClockData) {
    const employee = await this.employeeOf(userId);
    const day = await this.dayForToday(employee.id, data?.requestId);

    if (day.clockInTime) {
      throw new BadRequestException(
        `You clocked into ${day.request.requestNumber} at ${this.spokenTime(day.clockInTime)} today.`,
      );
    }

    const issueId = await this.resolveTask(day.request.id, employee.id, data?.issueId);
    const distanceKm = this.measureFromSite(day.request, data?.lat, data?.lng);

    // Attendance first, and deliberately not in a transaction with the day
    // below: it is the call that can still refuse — an abandoned session from
    // last week, an existing clock-in — and those refusals must leave the
    // field visit day untouched rather than half-clocked.
    await this.attendance.clockIn(
      userId,
      { lat: data?.lat, lng: data?.lng, ipAddress: data?.ipAddress },
      {
        fieldVisit: {
          requestId: day.request.id,
          requestNumber: day.request.requestNumber,
          projectId: day.request.project?.id ?? null,
        },
      },
    );

    return this.prisma.fieldVisitAttendance.update({
      where: { id: day.id },
      data: {
        clockInTime: new Date(),
        clockInLat: data.lat,
        clockInLng: data.lng,
        clockInDistanceKm: distanceKm,
        issueId,
        status: FIELD_VISIT_DAY.IN_PROGRESS,
      },
      select: this.DAY_SELECT,
    });
  }

  async clockOut(userId: number, data: ClockData) {
    const employee = await this.employeeOf(userId);
    const day = await this.dayForToday(employee.id, data?.requestId);

    if (!day.clockInTime) {
      throw new BadRequestException('You have not clocked into this field visit yet.');
    }
    if (day.clockOutTime) {
      throw new BadRequestException(
        `You clocked out of ${day.request.requestNumber} at ${this.spokenTime(day.clockOutTime)} today.`,
      );
    }

    // The same radius on the way out. Leaving the site and closing the day
    // from the road is exactly what the rule is there to catch.
    const distanceKm = this.measureFromSite(day.request, data?.lat, data?.lng);

    await this.attendance.clockOut(
      userId,
      { lat: data?.lat, lng: data?.lng, reason: data?.reason },
      {
        fieldVisit: {
          requestId: day.request.id,
          requestNumber: day.request.requestNumber,
          projectId: day.request.project?.id ?? null,
        },
      },
    );

    return this.prisma.fieldVisitAttendance.update({
      where: { id: day.id },
      data: {
        clockOutTime: new Date(),
        clockOutLat: data.lat,
        clockOutLng: data.lng,
        clockOutDistanceKm: distanceKm,
        status: FIELD_VISIT_DAY.COMPLETED,
      },
      select: this.DAY_SELECT,
    });
  }

  private spokenTime(at: Date): string {
    return at.toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
    });
  }
}
