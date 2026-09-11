import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { istHour } from '../common/timezone.util';

/** Sessions still open at this IST hour are closed out automatically. */
const SWEEP_HOUR = 23;

/**
 * The most a single auto-closed session may record.
 *
 * An abandoned timer's real duration is unknown. Recording the wall-clock gap
 * is plainly wrong — three of these had been running nine days and would have
 * written 213 hours each into a ticket. Recording zero is also wrong, and
 * quietly loses work somebody really did.
 *
 * So: cap it at a long-but-possible working day and mark the entry, which keeps
 * a plausible figure while making it obvious the number was not measured.
 * Anyone who cares can correct it from the note.
 */
const MAX_AUTO_CLOSE_HOURS = 8;

const AUTO_CLOSED_NOTE =
  `Auto-closed after being left running. Capped at ${MAX_AUTO_CLOSE_HOURS} hours — ` +
  'the real duration is unknown, so correct it if it matters.';

/**
 * Closes ticket timers nobody stopped.
 *
 * Ticket time tracking had no equivalent of the attendance auto-clock-out, so a
 * forgotten timer ran forever: it blocked the owner from starting a new one on
 * that ticket, and would eventually write an absurd duration. This mirrors
 * AutoClockoutCron deliberately — same hour, same once-per-day guard, same
 * setInterval approach, since @nestjs/schedule is not installed.
 */
@Injectable()
export class TicketTimerSweepCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TicketTimerSweepCron.name);
  private timer: NodeJS.Timeout;
  private isProcessing = false;
  private lastRunDateKey: string | null = null;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => this.checkAndRun(), 60 * 1000);
    // No startup sweep. AutoClockoutCron has one and it cost a day of
    // attendance when `nest start --watch` restarted on every file save; the
    // cutoff logic here is time-based anyway, so a boot adds nothing.
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private checkAndRun() {
    const now = new Date();
    if (istHour(now) < SWEEP_HOUR) return;

    // Once per IST day. Comparing "has today run" rather than matching an exact
    // minute means a delayed tick still fires instead of skipping the day.
    const dateKey = now.toISOString().slice(0, 10);
    if (this.lastRunDateKey === dateKey) return;
    this.lastRunDateKey = dateKey;

    this.sweepAbandonedTimers().catch((err) => {
      this.lastRunDateKey = null; // allow a retry on the next tick
      this.logger.error(`Ticket timer sweep failed: ${err.message}`);
    });
  }

  /**
   * Closes every timer that has been running longer than the cap.
   *
   * A timer started earlier today and still going is someone's live session —
   * only sessions already past the cap are touched, so the sweep can run at any
   * hour without cutting anybody's work short.
   */
  async sweepAbandonedTimers() {
    if (this.isProcessing) return { closed: 0 };
    this.isProcessing = true;

    try {
      const now = new Date();
      const capMs = MAX_AUTO_CLOSE_HOURS * 3600_000;
      const cutoff = new Date(now.getTime() - capMs);

      const abandoned = await this.prisma.ticketTimeEntry.findMany({
        where: { endTime: null, startTime: { lt: cutoff } },
        select: { id: true, startTime: true, notes: true },
      });

      for (const entry of abandoned) {
        await this.prisma.ticketTimeEntry.update({
          where: { id: entry.id },
          data: {
            // The cap, measured from the start — never "now", which is what
            // would turn a nine-day-old timer into a nine-day session.
            endTime: new Date(entry.startTime.getTime() + capMs),
            duration: MAX_AUTO_CLOSE_HOURS * 3600,
            notes: entry.notes ? `${entry.notes}\n${AUTO_CLOSED_NOTE}` : AUTO_CLOSED_NOTE,
          },
        });
      }

      if (abandoned.length) {
        this.logger.log(`Auto-closed ${abandoned.length} abandoned ticket timer(s)`);
      }
      return { closed: abandoned.length };
    } finally {
      this.isProcessing = false;
    }
  }
}
