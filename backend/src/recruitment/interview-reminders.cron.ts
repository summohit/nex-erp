import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Delivers each explicitly scheduled interview reminder once, at its saved IST time. */
@Injectable()
export class InterviewRemindersCron implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    setTimeout(() => void this.processDueReminders(), 5_000);
    this.timer = setInterval(() => void this.processDueReminders(), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async processDueReminders() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const interviews = await this.prisma.interview.findMany({
        where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        include: {
          interviewer: { select: { id: true } },
          application: { select: { companyId: true, fullName: true, answers: true, job: { select: { title: true } } } },
        },
      });

      for (const interview of interviews) {
        let parsed: any;
        try { parsed = interview.application.answers ? JSON.parse(interview.application.answers) : {}; } catch { parsed = {}; }
        const meta = parsed?.__interviewScheduleMeta?.[String(interview.id)];
        const reminderAt = meta?.reminderAt ? new Date(meta.reminderAt) : null;
        if (!reminderAt || reminderAt > now || meta.reminderSentAt || !interview.interviewerId) continue;

        await this.notifications.notifyEmployees([interview.interviewerId], {
          companyId: interview.application.companyId,
          title: 'Interview reminder',
          message: `Your ${interview.title} interview with ${interview.application.fullName} for ${interview.application.job?.title || 'the role'} is due soon.`,
          type: 'REMINDER',
          linkUrl: '/recruitment/interviews',
        });
        const base = Array.isArray(parsed) ? { answers: parsed } : (parsed && typeof parsed === 'object' ? parsed : { answers: parsed });
        await this.prisma.jobApplication.update({
          where: { id: interview.applicationId },
          data: { answers: JSON.stringify({ ...base, __interviewScheduleMeta: { ...(base.__interviewScheduleMeta || {}), [String(interview.id)]: { ...meta, reminderSentAt: now.toISOString() } } }) },
        });
      }
    } catch (error) {
      console.error('[Interview reminders] Failed to process due reminders:', error);
    } finally {
      this.running = false;
    }
  }
}
