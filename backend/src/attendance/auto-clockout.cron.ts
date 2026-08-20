import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const AUTO_CLOCKOUT_HOUR = 23; // 11 PM server-local time

@Injectable()
export class AutoClockoutCron implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout;
  private isProcessing = false;
  private lastRunDateKey: string | null = null;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    // Uses setInterval instead of @nestjs/schedule due to NPM installation restrictions.
    this.timer = setInterval(() => this.checkAndRun(), 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private checkAndRun() {
    const now = new Date();
    if (now.getHours() !== AUTO_CLOCKOUT_HOUR || now.getMinutes() !== 0) return;

    const dateKey = now.toDateString();
    if (this.lastRunDateKey === dateKey) return;
    this.lastRunDateKey = dateKey;

    this.autoClockOutOpenSessions().catch(err => {
      console.error('[Auto Clock-Out Cron] Error:', err.message);
    });
  }

  // Closes out anyone still clocked in at 11 PM, reusing each person's clock-in
  // location since there is no live device to ask for a fresh one.
  async autoClockOutOpenSessions() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = new Date();
      const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

      const openAttendances = await this.prisma.attendance.findMany({
        where: {
          date: today,
          clockIn: { not: null },
          clockOut: null
        },
        include: { logs: true }
      });

      for (const attendance of openAttendances) {
        const activeLog = attendance.logs.find(l => !l.clockOut);
        if (!activeLog) continue;

        const lat = activeLog.clockInLat ?? attendance.clockInLat ?? null;
        const lng = activeLog.clockInLng ?? attendance.clockInLng ?? null;

        await this.prisma.attendanceLog.update({
          where: { id: activeLog.id },
          data: { clockOut: now, clockOutLat: lat, clockOutLng: lng }
        });

        await this.prisma.attendance.update({
          where: { id: attendance.id },
          data: { clockOut: now, clockOutLat: lat, clockOutLng: lng }
        });
      }
    } catch (err) {
      console.error('[Auto Clock-Out Cron] General Error:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }
}
