import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { istDateKey, istHour } from '../common/timezone.util';

/** Sessions still open at this IST hour are flagged — never closed. */
const SWEEP_HOUR = 23;

/**
 * Says that a day was never clocked out of. Does not close it.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * This job used to write a clock-out at 23:00 IST for every session still open.
 * That record was a fiction: the time was a cutoff rather than an observation
 * and the coordinates were the clock-in's reused, so a day somebody forgot to
 * close read as a person who worked until eleven at night and left from where
 * they arrived — overtime and all. Worse, it erased the thing a manager needs
 * to see, which is that the clock-out is missing.
 *
 * The session now stays open until a human closes it, and this job's entire
 * output is `missedClockOut` plus a notification. Closing it is AttendanceService's
 * job, and after IST midnight it asks for a reason.
 *
 * Sessions closed by the old job keep their `autoClockedOut` marker and are not
 * reopened — see the migration for why.
 */
@Injectable()
export class MissedClockOutCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MissedClockOutCron.name);
  private timer: NodeJS.Timeout;
  private isProcessing = false;
  private lastRunDateKey: string | null = null;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // setInterval rather than @nestjs/schedule, which is not installed.
    this.timer = setInterval(() => this.checkAndRun(), 60 * 1000);
    // No startup sweep. The old job had one, and because it also WROTE
    // clock-outs, a mid-afternoon process restart could close the whole
    // company's live sessions. This one only flags, but there is still no
    // reason to re-notify everybody every time the backend restarts.
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private checkAndRun() {
    const now = new Date();
    // IST hour, not the server's — the rest of attendance is IST-fixed.
    if (istHour(now) < SWEEP_HOUR) return;

    // Once per IST day. "Has today run yet" rather than an exact-minute match,
    // so a delayed or drifting tick still fires instead of losing the day.
    const dateKey = istDateKey(now).toISOString();
    if (this.lastRunDateKey === dateKey) return;
    this.lastRunDateKey = dateKey;

    this.flagOpenSessions().catch((err) => {
      this.lastRunDateKey = null; // allow a retry on the next tick
      this.logger.error(`Missed clock-out sweep failed: ${err.message}`);
    });
  }

  /**
   * Flag every session that is still open, and tell the person.
   *
   * Scoped to days that have finished — today's row is included because the
   * sweep runs at 23:00, by which point today is effectively over, but a
   * session opened tonight for a shift that genuinely runs past midnight is
   * flagged too. That is the right trade: the flag is a prompt, not a penalty,
   * and clearing it costs one clock-out.
   */
  async flagOpenSessions(now: Date = new Date()): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      const today = istDateKey(now);

      const open = await this.prisma.attendance.findMany({
        where: {
          date: { lte: today },
          clockIn: { not: null },
          clockOut: null,
          // Only those not already flagged, so the notification goes out once
          // rather than every night for as long as the session stays open.
          missedClockOut: false,
        },
        select: {
          id: true,
          date: true,
          employee: { select: { id: true, userId: true, companyId: true } },
        },
      });
      if (!open.length) return 0;

      await this.prisma.attendance.updateMany({
        where: { id: { in: open.map((a) => a.id) } },
        data: { missedClockOut: true },
      });

      for (const row of open) {
        if (!row.employee?.userId) continue;
        const day = row.date.toISOString().slice(0, 10);
        await this.notifications.createNotification(
          row.employee.userId,
          'You did not clock out',
          `Your session from ${day} is still open. Please clock out — you will be asked for a reason, `
          + 'and you cannot start a new shift until it is closed.',
          'ACTION_REQUIRED',
          '/attendance-leave',
          row.employee.companyId,
        );
      }

      this.logger.log(`Flagged ${open.length} session(s) with no clock-out.`);
      return open.length;
    } finally {
      this.isProcessing = false;
    }
  }
}
