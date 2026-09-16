import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShiftRosterService } from './shift-roster.service';
import { hhmmToMinutes, istDateKey, istMinutesOfDay } from '../common/timezone.util';

/**
 * The reminders, as offsets in minutes from the shift boundary.
 *
 * Negative is before, positive is after. Kept as data rather than six branches
 * so adding "and again 30 minutes late" is one line, and so the spec is
 * readable at a glance against what the product actually sends.
 */
interface Reminder {
  kind: string;
  /** Minutes relative to the boundary. -10 means ten minutes before. */
  offset: number;
  anchor: 'START' | 'END';
  title: string;
  message: string;
}

const REMINDERS: Reminder[] = [
  {
    kind: 'CLOCK_IN_T10', anchor: 'START', offset: -10,
    title: 'Shift starts in 10 minutes',
    message: 'Your shift starts in 10 minutes. Please get ready to clock in.',
  },
  {
    kind: 'CLOCK_IN_T5', anchor: 'START', offset: -5,
    title: 'Shift starts in 5 minutes',
    message: 'Your shift starts in 5 minutes. Please clock in.',
  },
  {
    kind: 'CLOCK_IN_T1', anchor: 'START', offset: -1,
    title: 'Your shift is starting',
    message: 'Your shift is starting. Please clock in.',
  },
  {
    kind: 'CLOCK_OUT_T10', anchor: 'END', offset: -10,
    title: 'Shift ends in 10 minutes',
    message: 'Your shift ends in 10 minutes. Please remember to clock out.',
  },
  {
    kind: 'CLOCK_OUT_T5', anchor: 'END', offset: -5,
    title: 'Shift ends in 5 minutes',
    message: 'Your shift ends in 5 minutes. Please clock out.',
  },
  {
    kind: 'CLOCK_OUT_OVERDUE', anchor: 'END', offset: +10,
    title: 'Your shift has ended',
    message: 'Your shift has ended. Please clock out.',
  },
];

/**
 * Shift-time reminders to clock in and clock out.
 *
 * WHAT DECIDES WHO GETS ONE
 *
 * The person's *effective* shift for today — the roster entry if there is one,
 * the standing shift otherwise, resolved by the same rule clock-in uses. No
 * shift, a day off, or a shift with no start/end time means no reminder: a
 * duration-only shift has no boundary to be ten minutes away from, and someone
 * with no shift assigned has nothing to be reminded about. That is requirement
 * "notifications are not sent for users who do not have an assigned shift",
 * enforced by the absence of a window rather than by a separate check.
 *
 * WHY IT DOES NOT NAG
 *
 * A clock-in reminder is pointless once you have clocked in, and a clock-out
 * reminder is pointless once you have clocked out. Both are suppressed against
 * today's attendance row, so the person who arrives early is left alone.
 *
 * WHY IT CANNOT DOUBLE-SEND
 *
 * The tick is every minute and asks "is now the minute that is 10 before the
 * start". A restart, a slow tick, a clock correction or a second backend
 * instance would each answer yes again. ShiftReminderLog's unique key is the
 * guard: the row is written BEFORE the send, and a duplicate write means
 * somebody else already has it.
 */
@Injectable()
export class ShiftRemindersCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShiftRemindersCron.name);
  private timer: NodeJS.Timeout;
  private isProcessing = false;

  /**
   * How far past the intended minute a reminder may still be sent.
   *
   * The tick is nominally every 60s but drifts under load, and a tick that
   * lands 70 seconds late would otherwise skip the minute entirely and the
   * reminder would never go. Two minutes of slack, with the sent-log stopping
   * the duplicate that slack would otherwise allow.
   */
  private static readonly GRACE_MINUTES = 2;

  constructor(
    private prisma: PrismaService,
    private roster: ShiftRosterService,
    private notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // setInterval rather than @nestjs/schedule, which is not installed — same
    // approach as the other crons in this codebase.
    this.timer = setInterval(() => {
      this.run().catch((err) => this.logger.error(`Shift reminders failed: ${err.message}`));
    }, 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now: Date = new Date()) {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      await this.sweep(now);
    } finally {
      this.isProcessing = false;
    }
  }

  private async sweep(now: Date) {
    const today = istDateKey(now);
    const nowMinutes = istMinutesOfDay(now);

    // Only people who could possibly have a window today: a standing shift, or
    // a roster entry for today. Everyone else is excluded before any work.
    const [withStanding, rostered] = await Promise.all([
      this.prisma.employee.findMany({
        // Suspended accounts are excluded the way leave accrual does it — there
        // is no `active` flag on Employee, the user's status is the authority.
        where: { shiftId: { not: null }, user: { status: { not: 'SUSPENDED' } } },
        select: { id: true },
      }),
      this.prisma.shiftRosterEntry.findMany({
        where: { date: today },
        select: { employeeId: true },
      }),
    ]);

    const candidateIds = [
      ...new Set([...withStanding.map(e => e.id), ...rostered.map(r => r.employeeId)]),
    ];
    if (!candidateIds.length) return;

    const shifts = await this.roster.getEffectiveShiftsForDate(candidateIds, today);

    // Which of them are due something this minute, before touching attendance.
    const due: { employeeId: number; reminder: Reminder }[] = [];
    for (const employeeId of candidateIds) {
      const effective = shifts.get(employeeId);
      if (!effective || effective.isDayOff) continue;

      const startMinutes = hhmmToMinutes(effective.startTime);
      const endMinutes = hhmmToMinutes(effective.endTime);

      for (const reminder of REMINDERS) {
        const anchor = reminder.anchor === 'START' ? startMinutes : endMinutes;
        // No boundary, nothing to be early or late for. A duration-only shift
        // legitimately lands here and is correctly left alone.
        if (anchor === null) continue;
        if (this.isDueNow(anchor + reminder.offset, nowMinutes)) {
          due.push({ employeeId, reminder });
        }
      }
    }
    if (!due.length) return;

    // One read for the attendance of everyone due, rather than one per person.
    const attendance = await this.prisma.attendance.findMany({
      where: { employeeId: { in: [...new Set(due.map(d => d.employeeId))] }, date: today },
      select: { employeeId: true, clockIn: true, clockOut: true },
    });
    const attendanceByEmployee = new Map(attendance.map(a => [a.employeeId, a]));

    let sent = 0;
    for (const { employeeId, reminder } of due) {
      if (!this.stillWorthSending(reminder, attendanceByEmployee.get(employeeId))) continue;
      if (await this.send(employeeId, today, reminder)) sent++;
    }

    if (sent) this.logger.log(`Sent ${sent} shift reminder(s).`);
  }

  /**
   * Is `targetMinutes` the minute we are in, or one we just missed?
   *
   * Crossing midnight is real: a 00:05 shift start means the 10-minute warning
   * belongs to 23:55 the previous evening. Comparing modulo the day handles it
   * without special-casing, at the cost of a reminder for a 00:05 start being
   * logged under today's date — which is what we want, since the shift is
   * today's.
   */
  private isDueNow(targetMinutes: number, nowMinutes: number): boolean {
    const target = ((targetMinutes % 1440) + 1440) % 1440;
    const delta = ((nowMinutes - target) % 1440 + 1440) % 1440;
    return delta < ShiftRemindersCron.GRACE_MINUTES;
  }

  /**
   * Is this reminder still worth sending to this person, given their day so far?
   *
   * Clock-in reminders stop once they have clocked in — somebody who arrived
   * twenty minutes early does not need three more messages telling them to
   * arrive. Clock-out reminders are narrower: they only make sense to someone
   * who is clocked in RIGHT NOW. Sending "your shift ends in 10 minutes, please
   * clock out" to someone who is absent, on leave, or simply never clocked in
   * is an instruction they cannot follow, and the missing clock-IN is the thing
   * that actually needs their attention.
   */
  private stillWorthSending(
    reminder: Reminder,
    attendance: { clockIn: Date | null; clockOut: Date | null } | undefined,
  ): boolean {
    if (reminder.anchor === 'START') return !attendance?.clockIn;
    return !!attendance?.clockIn && !attendance.clockOut;
  }

  /**
   * Claim the reminder, then send it.
   *
   * The insert comes first on purpose. Sending first and recording after leaves
   * a window in which a crash re-sends; claiming first means the worst case is
   * a reminder that is recorded and never delivered, which is the better of the
   * two failures for something that pushes to a person's phone.
   */
  private async send(employeeId: number, date: Date, reminder: Reminder): Promise<boolean> {
    try {
      await this.prisma.shiftReminderLog.create({
        data: { employeeId, date, kind: reminder.kind },
      });
    } catch {
      // Unique violation — another tick or another instance already has it.
      return false;
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true, companyId: true },
    });
    if (!employee?.userId) return false;

    await this.notifications.createNotification(
      employee.userId,
      reminder.title,
      reminder.message,
      // Not mutable. Someone who mutes these and then misses a shift is worse
      // off than someone who is mildly annoyed by them, and the type is the
      // only thing standing between a reminder and a silenced phone.
      'ACTION_REQUIRED',
      '/attendance-leave',
      employee.companyId,
    );
    return true;
  }
}
