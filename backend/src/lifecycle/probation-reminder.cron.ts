import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { istDateKey } from '../common/timezone.util';
import { normalisePolicy } from './probation-policy';

/**
 * Probation reminders (policy, 4 Nov 2026): HR, Super Admin and the manager
 * hear N days before a probation ends (policy.reminderDays, default 30 and 7),
 * and every day once it is overdue — confirmation is always a decision, never
 * automatic. Runs once a day after 09:00 IST.
 */
@Injectable()
export class ProbationReminderCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProbationReminderCron.name);
  private timer?: NodeJS.Timeout;
  private lastRun = '';

  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  onModuleInit() {
    // setInterval rather than @nestjs/schedule, which is not installed.
    this.timer = setInterval(() => this.tick(), 15 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private tick() {
    const now = new Date();
    const today = istDateKey(now).toISOString().slice(0, 10);
    const istHour = (now.getUTCHours() + 5 + (now.getUTCMinutes() + 30 >= 60 ? 1 : 0)) % 24;
    if (this.lastRun === today || istHour < 9) return;
    this.lastRun = today;
    this.run(istDateKey(now)).catch((err) => this.logger.error(`Probation reminders failed: ${err.message}`));
  }

  async run(today: Date) {
    const open = await this.prisma.employee.findMany({
      where: { probationEndDate: { not: null }, probationConfirmedAt: null, offboardingStatus: { not: 'SEPARATED' }, user: { status: { notIn: ['SUSPENDED', 'INACTIVE', 'BLOCKED'] } } },
      select: { id: true, companyId: true, firstName: true, lastName: true, managerId: true, probationEndDate: true },
    });
    const policies = new Map<number, ReturnType<typeof normalisePolicy>>();
    for (const e of open) {
      if (!policies.has(e.companyId)) {
        const s = await this.prisma.systemSetting.findUnique({ where: { companyId: e.companyId }, select: { probationPolicy: true } });
        policies.set(e.companyId, normalisePolicy(s?.probationPolicy));
      }
      const policy = policies.get(e.companyId)!;
      const daysLeft = Math.round((e.probationEndDate!.getTime() - today.getTime()) / 86400000);
      const overdue = daysLeft < 0;
      if (!overdue && !policy.reminderDays.includes(daysLeft)) continue;

      const name = `${e.firstName} ${e.lastName ?? ''}`.trim();
      const end = e.probationEndDate!.toISOString().slice(0, 10);
      const message = overdue
        ? `${name}'s probation ended on ${end} (${-daysLeft} day(s) ago) and is not decided yet. Confirm, extend or start separation.`
        : `${name}'s probation ends on ${end} (in ${daysLeft} days). Review it: confirm, extend or start separation.`;
      const title = overdue ? 'Probation overdue' : 'Probation review due';

      const admins = await this.prisma.user.findMany({
        where: { companyId: e.companyId, role: { in: ['SUPERADMIN', 'SUPER_ADMIN', 'HR'] }, status: { notIn: ['SUSPENDED', 'INACTIVE', 'BLOCKED'] } },
        select: { id: true },
      });
      for (const a of admins) {
        await this.notifications.createNotification(a.id, title, message, 'GENERAL', '/performance?tab=probation', e.companyId).catch(() => undefined);
      }
      if (e.managerId) {
        await this.notifications.notifyEmployees([e.managerId], { companyId: e.companyId, title, message, type: 'GENERAL', linkUrl: '/performance?tab=probation' }).catch(() => undefined);
      }
    }
  }
}
