import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Reminder thresholds. A threshold fires once, when the remaining time until the
// due date falls into its (lower, upper] window. Duplicates are prevented via the
// IssueReminder table (unique per issue + threshold).
const DAY_THRESHOLDS = [
  { key: 'DAY_7', lower: 6 * DAY, upper: 7 * DAY, label: '7 days' },
  { key: 'DAY_3', lower: 2 * DAY, upper: 3 * DAY, label: '3 days' },
  { key: 'DAY_2', lower: 1 * DAY, upper: 2 * DAY, label: '2 days' },
  { key: 'DAY_1', lower: 4 * HOUR, upper: 1 * DAY, label: '1 day' },
];

const HOUR_THRESHOLDS = [
  { key: 'HOUR_4', lower: 3 * HOUR, upper: 4 * HOUR, label: '4 hours' },
  { key: 'HOUR_3', lower: 90 * MIN, upper: 3 * HOUR, label: '3 hours' },
  { key: 'HOUR_90MIN', lower: 0, upper: 90 * MIN, label: '1 hour 30 minutes' },
];

@Injectable()
export class IssueRemindersCron implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout;
  private isProcessing = false;

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService
  ) {}

  onModuleInit() {
    // Uses setInterval instead of @nestjs/schedule due to NPM installation restrictions.
    const intervalMs = 60 * 1000;

    setTimeout(() => this.processDueDateReminders(), 5000);

    this.timer = setInterval(() => {
      this.processDueDateReminders();
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async processDueDateReminders() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = new Date();
      const nowMs = now.getTime();

      const issues = await this.prisma.issue.findMany({
        where: {
          isArchived: false,
          dueDate: { not: null },
          status: { notIn: ['DONE', 'CANCELLED'] }
        },
        select: {
          id: true, key: true, title: true, dueDate: true, status: true,
          companyId: true, assigneeId: true, projectId: true, isLate: true
        }
      });

      if (issues.length === 0) return;

      // Batch-load already-sent reminders for the candidate issues
      const issueIds = issues.map(i => i.id);
      const existing = await this.prisma.issueReminder.findMany({
        where: { issueId: { in: issueIds } },
        select: { issueId: true, threshold: true }
      });
      const sentSet = new Set(existing.map(e => `${e.issueId}:${e.threshold}`));

      // Batch-load assignee user ids (notifications target User, not Employee)
      const assigneeIds = [...new Set(issues.map(i => i.assigneeId).filter((id): id is number => !!id))];
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, userId: true }
      });
      const userByEmployee = new Map<number, number | null>(employees.map(e => [e.id, e.userId]));

      for (const issue of issues) {
        const dueMs = (issue.dueDate as Date).getTime();
        const r = dueMs - nowMs; // ms remaining until due
        const isOpen = issue.status === 'TODO' || issue.status === 'IN_PROGRESS';

        // Keep the persisted "late" flag in sync with reality
        const shouldBeLate = r <= 0 && isOpen;
        if (issue.isLate !== shouldBeLate) {
          await this.prisma.issue.update({
            where: { id: issue.id },
            data: { isLate: shouldBeLate }
          });
        }

        let thresholdKey: string | null = null;
        let label: string | null = null;

        if (r > 0) {
          const day = DAY_THRESHOLDS.find(t => r > t.lower && r <= t.upper);
          const hour = day ? null : HOUR_THRESHOLDS.find(t => r > t.lower && r <= t.upper);
          if (day) { thresholdKey = day.key; label = day.label; }
          else if (hour) { thresholdKey = hour.key; label = hour.label; }
        } else {
          thresholdKey = 'DUE';
          label = 'Time is up';
        }

        if (!thresholdKey || !issue.assigneeId) continue;

        if (sentSet.has(`${issue.id}:${thresholdKey}`)) continue;

        const userId = userByEmployee.get(issue.assigneeId);
        if (!userId) continue;

        const message = thresholdKey === 'DUE'
          ? `Task ${issue.key} (${issue.title}) time is up. Please submit it for review.`
          : `Task ${issue.key} (${issue.title}) has ${label} left. Please submit it before the deadline.`;

        await this.notificationsService.createNotification(
          userId,
          'Task due soon',
          message,
          'WARNING',
          `/projects/${issue.projectId}?issue=${issue.key}`,
          issue.companyId
        );

        await this.prisma.issueReminder.create({
          data: { issueId: issue.id, threshold: thresholdKey, companyId: issue.companyId }
        });
        sentSet.add(`${issue.id}:${thresholdKey}`);
      }
    } catch (err) {
      console.error('[Issue Reminders Cron] General Error:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }
}
