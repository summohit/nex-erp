import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { istDateKey } from '../common/timezone.util';

/**
 * Leave accrual and year-end carry-forward.
 *
 * Replaces a `setInterval(…, 24h)` in LeavesService that measured 24 hours from
 * process start and then returned early unless that tick happened to land on
 * the 1st of a month. Every deploy and every pm2 restart reset the clock, so it
 * almost never fired — and nothing recorded that a period had been credited, so
 * two runs would have credited twice.
 *
 * Now: a one-minute tick, IST calendar dates (the rest of the app is IST-fixed
 * for exactly this reason — the server's own timezone is not to be trusted),
 * and idempotency held in the database rather than in memory, so a restart
 * mid-run cannot double-credit.
 */
@Injectable()
export class LeaveAccrualCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeaveAccrualCron.name);
  private timer: NodeJS.Timeout;
  private isProcessing = false;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    // setInterval rather than @nestjs/schedule, which is not installed —
    // matching AutoClockoutCron and TicketTimerSweepCron.
    this.timer = setInterval(() => this.tick(), 60 * 1000);
    // Sweep on boot too. Unlike the attendance sweep this is safe to repeat:
    // every write is guarded by a period stamp, so a boot on the 1st credits
    // at most once no matter how many times the process restarts.
    this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private tick() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.run()
      .catch((err) => this.logger.error(`Leave accrual run failed: ${err.message}`))
      .finally(() => { this.isProcessing = false; });
  }

  /** IST calendar fields for an instant, via the UTC-midnight key. */
  private istParts(now: Date) {
    const key = istDateKey(now);
    return {
      year: key.getUTCFullYear(),
      month: key.getUTCMonth() + 1, // 1-12
      day: key.getUTCDate(),
    };
  }

  async run(now: Date = new Date()) {
    const { year, month, day } = this.istParts(now);
    if (day !== 1) return { accrued: 0, carried: 0 };

    const accrued = await this.processAccruals(year, month);
    // Carry-forward happens once, on 1 January, and reads the year that just
    // ended. Accrual runs first so a January credit is not rolled over twice.
    const carried = month === 1 ? await this.processCarryForward(year) : 0;
    return { accrued, carried };
  }

  /**
   * Credit MONTHLY types on the 1st of every month, YEARLY types on 1 January.
   *
   * Note for whoever reads the logs and sees nothing: every live LeaveType
   * currently has accrualAmount 0, so nothing is credited until somebody sets
   * an amount. Days are allocated up front via defaultDays instead.
   */
  async processAccruals(year: number, month: number): Promise<number> {
    const types = await this.prisma.leaveType.findMany({
      where: { accrualAmount: { gt: 0 }, accrualFrequency: { in: ['MONTHLY', 'YEARLY'] } },
      select: { id: true, name: true, accrualFrequency: true, accrualAmount: true },
    });

    let credited = 0;
    for (const type of types) {
      if (type.accrualFrequency === 'YEARLY' && month !== 1) continue;

      const period = type.accrualFrequency === 'MONTHLY'
        ? `${year}-${String(month).padStart(2, '0')}`
        : `${year}`;

      // One statement does the credit AND the stamp, so concurrent or repeated
      // runs match zero rows the second time. The explicit null branch matters:
      // `{ not: period }` compiles to NOT (col = 'x'), which is NULL — and so
      // excludes every row that has never accrued.
      const res = await this.prisma.leaveBalance.updateMany({
        where: {
          leaveTypeId: type.id,
          year,
          OR: [{ lastAccruedPeriod: null }, { lastAccruedPeriod: { not: period } }],
        },
        data: {
          allocated: { increment: type.accrualAmount },
          lastAccruedPeriod: period,
        },
      });

      if (res.count) {
        credited += res.count;
        this.logger.log(`Accrued ${type.accrualAmount} to ${res.count} balance(s) of "${type.name}" for ${period}`);
      }
    }
    return credited;
  }

  /**
   * Roll unused days from the year that just ended into the new one.
   *
   * Never implemented before: carryForward and carryForwardLimit were editable
   * and seeded (Earned Leave true/5), but carriedOver was written by no code,
   * so unused days silently vanished each January.
   *
   * A limit of 0 means no cap, not "carry nothing" — the field only appears
   * once carry-forward is switched on, and a cap of zero would make the switch
   * do nothing at all.
   */
  async processCarryForward(newYear: number): Promise<number> {
    const previousYear = newYear - 1;

    const types = await this.prisma.leaveType.findMany({
      where: { carryForward: true },
      select: { id: true, name: true, carryForwardLimit: true },
    });
    if (!types.length) return 0;

    let rolled = 0;
    for (const type of types) {
      const previous = await this.prisma.leaveBalance.findMany({
        where: { leaveTypeId: type.id, year: previousYear },
        select: { employeeId: true, allocated: true, used: true, carriedOver: true },
      });

      for (const row of previous) {
        // Last year's own carry-over counts toward what is available, or days
        // rolled in would be lost the following year.
        const remaining = row.allocated + row.carriedOver - row.used;
        if (remaining <= 0) continue;

        const capped = type.carryForwardLimit > 0
          ? Math.min(remaining, type.carryForwardLimit)
          : remaining;

        // updateMany, not update: the guard belongs in the WHERE so a repeat
        // run matches nothing, and a missing target row is skipped rather than
        // throwing. Employees with no row for the new year are left alone —
        // they have no entitlement to add to yet.
        const res = await this.prisma.leaveBalance.updateMany({
          where: {
            employeeId: row.employeeId,
            leaveTypeId: type.id,
            year: newYear,
            carriedForwardFromYear: null,
          },
          data: {
            carriedOver: capped,
            carriedForwardFromYear: previousYear,
          },
        });
        rolled += res.count;
      }

      if (rolled) {
        this.logger.log(`Carried forward "${type.name}" from ${previousYear} into ${newYear}`);
      }
    }

    if (rolled) this.logger.log(`Carried forward ${rolled} balance(s) into ${newYear}`);
    return rolled;
  }
}
