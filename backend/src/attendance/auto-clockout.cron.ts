import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { istDateKey, istHour, istTimeInstant } from '../common/timezone.util';

/** Sessions still open at this IST hour are closed out automatically. */
const AUTO_CLOCKOUT_HOUR = 23;
const AUTO_CLOCKOUT_TIME = '23:00';

@Injectable()
export class AutoClockoutCron implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout;
  private isProcessing = false;
  private lastRunDateKey: string | null = null;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    // setInterval rather than @nestjs/schedule, which is not installed.
    this.timer = setInterval(() => this.checkAndRun(), 60 * 1000);
    // Also sweep on boot so sessions left open while the process was down
    // (or before this job worked at all) get closed rather than lingering.
    this.autoClockOutOpenSessions().catch((err) =>
      console.error('[Auto Clock-Out] Startup sweep failed:', err.message),
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private checkAndRun() {
    const now = new Date();
    // IST hour, not the server's local hour — the rest of attendance is
    // IST-fixed and this must agree with it.
    if (istHour(now) < AUTO_CLOCKOUT_HOUR) return;

    // Run once per IST day. Comparing "has today run yet" instead of matching
    // an exact minute means a delayed or drifting tick still fires, where the
    // old `getMinutes() === 0` check would skip the whole day.
    const dateKey = istDateKey(now).toISOString();
    if (this.lastRunDateKey === dateKey) return;
    this.lastRunDateKey = dateKey;

    this.autoClockOutOpenSessions().catch((err) => {
      // Allow a retry on the next tick rather than losing the day.
      this.lastRunDateKey = null;
      console.error('[Auto Clock-Out] Error:', err.message);
    });
  }

  /**
   * Closes every attendance still clocked in, up to and including today.
   *
   * Each session is closed at 23:00 IST *of its own day*, not "now" — otherwise
   * a session left open for three days would record a 72-hour shift. The
   * clock-in coordinates are reused, since there is no live device to ask.
   */
  async autoClockOutOpenSessions() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = new Date();
      const today = istDateKey(now);

      const openAttendances = await this.prisma.attendance.findMany({
        where: {
          date: { lte: today },
          clockIn: { not: null },
          clockOut: null,
        },
        include: { logs: true, employee: { include: { shift: true } } },
      });

      for (const attendance of openAttendances) {
        // 23:00 IST on the day this attendance belongs to.
        let cutoff = istTimeInstant(attendance.date, AUTO_CLOCKOUT_TIME);

        // A shift starting late in the evening can clock in after the cutoff.
        // Never write a clock-out that precedes the clock-in.
        if (attendance.clockIn && cutoff < attendance.clockIn) {
          cutoff = attendance.clockIn;
        }
        // Today's sweep should never stamp a time in the future.
        if (cutoff > now) cutoff = now;

        // Mirror the manual clock-out so an auto-closed day is scored the same
        // way — otherwise anyone who forgets silently loses their overtime.
        let isEarlyLeave = false;
        let status = attendance.status ?? 'PRESENT';
        let overtimeHours = 0;

        const shift = attendance.employee?.shift;
        if (shift?.endTime) {
          const expectedEnd = istTimeInstant(cutoff, shift.endTime);
          if (cutoff < expectedEnd) {
            isEarlyLeave = true;
            status = 'HALF_DAY';
          } else {
            const diffMs = cutoff.getTime() - expectedEnd.getTime();
            if (diffMs > 30 * 60000) {
              overtimeHours = parseFloat((diffMs / 3600000).toFixed(2));
            }
          }
        }

        const openLogs = attendance.logs.filter((l) => !l.clockOut);
        for (const log of openLogs) {
          const logCutoff = cutoff < log.clockIn ? log.clockIn : cutoff;
          await this.prisma.attendanceLog.update({
            where: { id: log.id },
            data: {
              clockOut: logCutoff,
              clockOutLat: log.clockInLat ?? attendance.clockInLat ?? null,
              clockOutLng: log.clockInLng ?? attendance.clockInLng ?? null,
            },
          });
        }

        await this.prisma.attendance.update({
          where: { id: attendance.id },
          data: {
            clockOut: cutoff,
            clockOutLat: attendance.clockInLat ?? null,
            clockOutLng: attendance.clockInLng ?? null,
            isEarlyLeave,
            status,
            overtimeHours,
          },
        });
      }

      if (openAttendances.length) {
        console.log(`[Auto Clock-Out] Closed ${openAttendances.length} open session(s).`);
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
