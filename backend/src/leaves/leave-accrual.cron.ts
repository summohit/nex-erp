import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { istDateKey } from '../common/timezone.util';

/**
 * Leave accrual and the new year's opening allocation.
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
 *
 * Nothing rolls over. Leave belongs to the year it was granted in; what is left
 * at the end of it is bought back on that year's last payslip (see
 * PayrollService.settleLeaveEncashment) and the new year opens with a fresh
 * allocation rather than an inherited one.
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
    if (day !== 1) return { accrued: 0, opened: 0 };

    // Open the year before accruing: a YEARLY type credits on 1 January too,
    // and it has to credit onto the row this just created, not miss it and
    // leave the employee a year short.
    const opened = month === 1 ? await this.openYear(year) : 0;
    const accrued = await this.processAccruals(year, month);
    return { accrued, opened };
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
   * Give every active employee their fresh allocation for the new year.
   *
   * Replaces carry-forward, which rolled the previous year's unused days into
   * the new one. Leave now ends with its year — the leftovers are paid out on
   * the December payslip instead — so January starts from defaultDays and
   * nothing else. What the employee did or did not take last year has no
   * bearing on this number.
   *
   * Types with defaultDays 0 get no row: an unpaid LOP type has no entitlement
   * to allocate, and a row of zeros only makes the quota report noisier.
   */
  async openYear(year: number): Promise<number> {
    const types = await this.prisma.leaveType.findMany({
      where: { defaultDays: { gt: 0 } },
      select: { id: true, name: true, defaultDays: true, companyId: true },
    });
    if (!types.length) return 0;

    // Suspended staff are off payroll and off the leave register — matching
    // payslip generation, which skips them too.
    const employees = await this.prisma.employee.findMany({
      where: { user: { status: { not: 'SUSPENDED' } } },
      select: { id: true, companyId: true },
    });
    if (!employees.length) return 0;

    const byCompany = new Map<number, number[]>();
    for (const emp of employees) {
      const list = byCompany.get(emp.companyId) ?? [];
      list.push(emp.id);
      byCompany.set(emp.companyId, list);
    }

    let opened = 0;
    for (const type of types) {
      const employeeIds = byCompany.get(type.companyId) ?? [];
      if (!employeeIds.length) continue;

      // Only the ones that have no row yet. An existing row is left exactly as
      // it is: HR may have already allocated by hand, or granted an exception,
      // and a job that runs on every boot must not overwrite either.
      const existing = await this.prisma.leaveBalance.findMany({
        where: { leaveTypeId: type.id, year, employeeId: { in: employeeIds } },
        select: { employeeId: true },
      });
      const has = new Set(existing.map((b) => b.employeeId));
      const missing = employeeIds.filter((id) => !has.has(id));
      if (!missing.length) continue;

      // skipDuplicates covers the race the read above cannot: two processes
      // both finding the row absent. The unique key is the real guard.
      const res = await this.prisma.leaveBalance.createMany({
        data: missing.map((employeeId) => ({
          employeeId,
          leaveTypeId: type.id,
          year,
          allocated: type.defaultDays,
          used: 0,
        })),
        skipDuplicates: true,
      });

      if (res.count) {
        opened += res.count;
        this.logger.log(`Opened ${year} with ${type.defaultDays} day(s) of "${type.name}" for ${res.count} employee(s)`);
      }
    }

    if (opened) this.logger.log(`Opened ${opened} leave balance(s) for ${year}`);
    return opened;
  }
}
