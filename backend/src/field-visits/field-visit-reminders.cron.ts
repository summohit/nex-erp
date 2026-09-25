import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { istDateKey, istDateKeyShift, istMinutesOfDay, hhmmToMinutes } from '../common/timezone.util';
import { FIELD_VISIT_STATUS, FIELD_VISIT_DAY, OPEN_VISIT_DAYS } from './field-visit-status';

/**
 * The reminders a field visit sends, and the sweep that closes one (§3, §12).
 *
 * Four jobs on one minute tick:
 *
 *   - the evening before, tell everybody they are on site tomorrow;
 *   - shortly before the expected start, tell whoever has not clocked in;
 *   - shortly before the expected end, tell whoever has not clocked out;
 *   - after midnight, close trips whose last day has passed.
 *
 * That last one exists because COMPLETED was a status nothing ever set, so
 * every approved trip stayed approved for ever — including ones that finished
 * months ago. The clock closes a trip the moment its final day is clocked out;
 * this catches the ones where somebody simply never clocked.
 *
 * setInterval rather than @nestjs/schedule, which is not installed — the same
 * approach as the other crons here.
 */
@Injectable()
export class FieldVisitRemindersCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FieldVisitRemindersCron.name);
  private timer: NodeJS.Timeout;
  private isProcessing = false;

  /**
   * How far past the intended minute a reminder may still go out.
   *
   * The tick drifts under load, and one that lands 70 seconds late would skip
   * the minute entirely and the reminder would never be sent. The sent-log
   * stops the duplicate that this slack would otherwise allow.
   */
  private static readonly GRACE_MINUTES = 2;

  /** When the evening-before reminder goes out, in IST minutes (18:00). */
  private static readonly EVENING_BEFORE = 18 * 60;

  /** How long before the expected clock-in and clock-out to nudge. */
  private static readonly BEFORE_START = 15;
  private static readonly BEFORE_END = 10;

  /** When the completion sweep runs, in IST minutes (00:30). */
  private static readonly SWEEP_AT = 30;

  private readonly LINK = '/field-visits/my';

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.run().catch((err) =>
        this.logger.error(`Field visit reminders failed: ${err.message}`));
    }, 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now: Date = new Date()) {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const minutes = istMinutesOfDay(now);
      if (this.isDue(minutes, FieldVisitRemindersCron.EVENING_BEFORE)) {
        await this.remindTomorrow(now);
      }
      await this.remindClockInOut(now, minutes);
      if (this.isDue(minutes, FieldVisitRemindersCron.SWEEP_AT)) {
        await this.closeFinishedTrips(now);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private isDue(nowMinutes: number, target: number): boolean {
    const delta = nowMinutes - target;
    return delta >= 0 && delta < FieldVisitRemindersCron.GRACE_MINUTES;
  }

  // ─── The evening before ────────────────────────────────────────────────────

  private async remindTomorrow(now: Date) {
    const tomorrow = istDateKeyShift(now, 1);
    const days = await this.daysOn(tomorrow);

    for (const day of days) {
      await this.send(day, tomorrow, 'FV_TOMORROW', 'Field visit tomorrow',
        `${day.request.requestNumber} at ${day.request.location} tomorrow,`
        + ` ${day.request.startTime}–${day.request.endTime}.`);
    }
  }

  // ─── On the day ────────────────────────────────────────────────────────────

  private async remindClockInOut(now: Date, minutes: number) {
    const today = istDateKey(now);
    const days = await this.daysOn(today);
    if (!days.length) return;

    for (const day of days) {
      const start = hhmmToMinutes(day.request.startTime);
      const end = hhmmToMinutes(day.request.endTime);

      // Not clocked in, and the day is about to start.
      if (
        start != null
        && !day.clockInTime
        && this.isDue(minutes, start - FieldVisitRemindersCron.BEFORE_START)
      ) {
        await this.send(day, today, 'FV_CLOCK_IN', 'Field visit starts shortly',
          `${day.request.requestNumber} at ${day.request.location} starts at`
          + ` ${day.request.startTime}. Clock in from the site — you must be within`
          + ` ${day.request.geofenceRadiusM} m of it.`);
      }

      // Clocked in, not out, and the day is about to end.
      if (
        end != null
        && day.clockInTime
        && !day.clockOutTime
        && this.isDue(minutes, end - FieldVisitRemindersCron.BEFORE_END)
      ) {
        await this.send(day, today, 'FV_CLOCK_OUT', 'Remember to clock out',
          `${day.request.requestNumber} ends at ${day.request.endTime}.`
          + ' Clock out before you leave the site — the same radius applies.');
      }
    }
  }

  /** Everybody expected on an approved trip on one calendar day. */
  private async daysOn(date: Date) {
    return this.prisma.fieldVisitAttendance.findMany({
      where: {
        visitDate: date,
        // Somebody on leave is not coming, and a finished day needs nothing.
        status: { in: OPEN_VISIT_DAYS },
        request: { status: FIELD_VISIT_STATUS.APPROVED },
      },
      select: {
        id: true, employeeId: true, clockInTime: true, clockOutTime: true,
        employee: { select: { userId: true, companyId: true } },
        request: {
          select: {
            requestNumber: true, location: true,
            startTime: true, endTime: true, geofenceRadiusM: true,
          },
        },
      },
    });
  }

  /**
   * Claim the reminder, then send it.
   *
   * The insert comes first on purpose: sending first and recording after
   * leaves a window in which a crash re-sends, while claiming first means the
   * worst case is a reminder recorded and never delivered — the better of the
   * two failures for something that reaches a person's phone.
   */
  private async send(
    day: any, date: Date, kind: string, title: string, message: string,
  ): Promise<void> {
    try {
      await this.prisma.shiftReminderLog.create({
        data: { employeeId: day.employeeId, date, kind },
      });
    } catch {
      return; // Unique violation — another tick or instance already has it.
    }

    if (!day.employee?.userId) return;
    await this.notifications.createNotification(
      day.employee.userId,
      title,
      message,
      // Not mutable: somebody who silences these and then misses a site visit
      // is worse off than somebody mildly annoyed by them.
      'ACTION_REQUIRED',
      this.LINK,
      day.employee.companyId,
    );
  }

  // ─── Closing a trip that has run ──────────────────────────────────────────

  private async closeFinishedTrips(now: Date) {
    const today = istDateKey(now);

    const finished = await this.prisma.fieldVisitRequest.findMany({
      where: {
        status: FIELD_VISIT_STATUS.APPROVED,
        endDate: { lt: today },
      },
      select: { id: true, requestNumber: true, raisedById: true },
    });
    if (!finished.length) return;

    for (const request of finished) {
      await this.prisma.$transaction(async (tx) => {
        await tx.fieldVisitRequest.update({
          where: { id: request.id },
          data: { status: FIELD_VISIT_STATUS.COMPLETED },
        });
        // A day nobody ever clocked is not left looking like it is still
        // coming; the trip is over either way.
        await tx.fieldVisitAttendance.updateMany({
          where: { requestId: request.id, status: FIELD_VISIT_DAY.SCHEDULED },
          data: { status: FIELD_VISIT_DAY.COMPLETED },
        });
        await tx.fieldVisitRequestActivity.create({
          data: {
            requestId: request.id,
            action: 'COMPLETED',
            detail: 'The last day of the visit has passed',
            actorId: request.raisedById,
          },
        });
      });
    }
    this.logger.log(`Closed ${finished.length} finished field visit(s).`);
  }
}
