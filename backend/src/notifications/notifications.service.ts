import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsGateway: NotificationsGateway
  ) {}

  /**
   * The header bell calls this with no options and still gets its 50 newest.
   * The history page passes filters and paging — hence `total`, which the bell
   * ignores but the pager needs.
   */
  async getUserNotifications(
    userId: number,
    opts: { type?: string; unreadOnly?: boolean; skip?: number; take?: number } = {},
  ) {
    const where: any = { userId };
    if (opts.type) where.type = opts.type;
    if (opts.unreadOnly) where.isRead = false;

    const take = Math.min(Math.max(Number(opts.take) || 50, 1), 100);
    const skip = Math.max(Number(opts.skip) || 0, 0);

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
      // Always the unfiltered unread count — it drives the bell badge.
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return { notifications, unreadCount, total, skip, take };
  }

  /** Distinct types present for this user, so the filter only offers real ones. */
  async getUserNotificationTypes(userId: number) {
    const rows = await this.prisma.notification.groupBy({
      by: ['type'],
      where: { userId },
      _count: { _all: true },
    });
    return rows
      .map((r) => ({ type: r.type, count: r._count._all }))
      .sort((a, b) => b.count - a.count);
  }

  async markAsRead(notificationId: number, userId: number) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });

    return this.getUserNotifications(userId);
  }

  async markAllAsRead(userId: number) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return this.getUserNotifications(userId);
  }

  async createNotification(
    userId: number,
    title: string,
    message: string,
    type = 'INFO',
    linkUrl?: string,
    companyId?: number
  ) {
    try {
      // Find companyId from user if not passed
      let effectiveCompanyId = companyId;
      if (!effectiveCompanyId) {
        const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
        effectiveCompanyId = u?.companyId;
      }

      if (!effectiveCompanyId) return;

      // One gate for every caller. ACTION_REQUIRED is deliberately not mutable —
      // it means someone is blocked waiting on this person, which is exactly the
      // thing a mute would hide.
      if (type !== 'ACTION_REQUIRED' && (await this.isMuted(userId, type))) return;

      const notification = await this.prisma.notification.create({
        data: {
          userId,
          title,
          message,
          type,
          linkUrl,
          companyId: effectiveCompanyId,
        },
      });

      // Emit real-time WebSocket packet to user room
      this.notificationsGateway.sendToUser(userId, notification);

      return notification;
    } catch (error) {
      this.logger.error(`Failed to create notification for user ${userId}:`, error);
    }
  }

  /** Types a user is never allowed to mute — they mean somebody is blocked. */
  static readonly UNMUTABLE_TYPES = ['ACTION_REQUIRED'];

  private async isMuted(userId: number, type: string): Promise<boolean> {
    try {
      const pref = await this.prisma.notificationPreference.findUnique({
        where: { userId_type: { userId, type } },
        select: { muted: true },
      });
      return !!pref?.muted;
    } catch (error) {
      // If the preference table is unreachable, deliver rather than drop —
      // losing a notification is worse than showing a muted one.
      this.logger.error(`Failed to read notification preference for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * A user's muted types. Absent from the list means the type is on.
   *
   * `available: false` means the preference table isn't there yet (the migration
   * SQL hasn't been run). Reporting that beats letting the UI render toggles
   * that silently snap back on every click.
   */
  async getPreferences(userId: number) {
    try {
      const rows = await this.prisma.notificationPreference.findMany({
        where: { userId },
        select: { type: true, muted: true },
      });
      return {
        available: true,
        muted: rows.filter((r) => r.muted).map((r) => r.type),
        unmutable: NotificationsService.UNMUTABLE_TYPES,
      };
    } catch (error) {
      this.logger.error(`Notification preferences unavailable for user ${userId}:`, error);
      return { available: false, muted: [], unmutable: NotificationsService.UNMUTABLE_TYPES };
    }
  }

  /** Mute or unmute one type. Unmuting deletes the row rather than storing false. */
  async setPreference(userId: number, type: string, muted: boolean) {
    if (!type) throw new Error('A notification type is required');
    if (muted && NotificationsService.UNMUTABLE_TYPES.includes(type)) {
      // Silently refusing would look like a broken toggle, so be explicit.
      throw new BadRequestException(`"${type}" notifications cannot be turned off.`);
    }

    if (muted) {
      await this.prisma.notificationPreference.upsert({
        where: { userId_type: { userId, type } },
        create: { userId, type, muted: true },
        update: { muted: true },
      });
    } else {
      await this.prisma.notificationPreference.deleteMany({ where: { userId, type } });
    }
    return this.getPreferences(userId);
  }

  /**
   * Notify people identified by EMPLOYEE id rather than user id.
   *
   * Most of the app holds employee ids (assignees, owners, reporters) while
   * notifications address users, so without this every caller repeats the same
   * lookup. Skips the actor, skips employees with no linked user account, and
   * never throws — the record being notified about is already committed.
   */
  async notifyEmployees(
    employeeIds: (number | null | undefined)[],
    opts: {
      companyId: number;
      title: string;
      message: string;
      type?: string;
      linkUrl?: string;
      /** The person who caused the change; never notified about their own action. */
      excludeEmployeeId?: number | null;
    },
  ): Promise<number> {
    try {
      const targets = [
        ...new Set(
          employeeIds.filter(
            (id): id is number => !!id && id !== opts.excludeEmployeeId,
          ),
        ),
      ];
      if (targets.length === 0) return 0;

      const employees = await this.prisma.employee.findMany({
        where: { id: { in: targets }, companyId: opts.companyId },
        select: { userId: true },
      });

      let sent = 0;
      for (const emp of employees) {
        if (!emp.userId) continue;
        await this.createNotification(
          emp.userId,
          opts.title,
          opts.message,
          opts.type ?? 'INFO',
          opts.linkUrl,
          opts.companyId,
        );
        sent++;
      }
      return sent;
    } catch (error) {
      this.logger.error('Failed to notify employees:', error);
      return 0;
    }
  }

  /**
   * Notify whoever can action a pending item: the subject's reporting manager
   * plus everyone holding an approving role. Every approval queue needs the same
   * three things — resolve the roles, fold in the manager, never tell the person
   * who raised it — so they live here rather than in each module.
   *
   * Returns the number of people reached, which callers can log when a queue
   * turns out to have no approver at all.
   */
  async notifyApprovers(opts: {
    companyId: number;
    roles: string[];
    title: string;
    message: string;
    type?: string;
    linkUrl?: string;
    /** The requester — never notified about their own submission. */
    excludeUserId?: number | null;
    /** Reporting manager's user id, when the flow has one. */
    managerUserId?: number | null;
  }): Promise<number> {
    const recipients = new Set<number>();

    if (opts.managerUserId && opts.managerUserId !== opts.excludeUserId) {
      recipients.add(opts.managerUserId);
    }

    try {
      const users = await this.prisma.user.findMany({
        where: {
          companyId: opts.companyId,
          role: { in: opts.roles },
          status: 'ACTIVE',
          ...(opts.excludeUserId ? { id: { not: opts.excludeUserId } } : {}),
        },
        select: { id: true },
      });
      users.forEach((u) => recipients.add(u.id));
    } catch (error) {
      this.logger.error('Failed to resolve approver list:', error);
    }

    // The manager may also hold an approving role; the Set already deduped that.
    recipients.delete(opts.excludeUserId as number);

    for (const userId of recipients) {
      await this.createNotification(
        userId,
        opts.title,
        opts.message,
        opts.type ?? 'ACTION_REQUIRED',
        opts.linkUrl,
        opts.companyId,
      );
    }

    if (recipients.size === 0) {
      this.logger.warn(`No approver found for "${opts.title}" in company ${opts.companyId}.`);
    }
    return recipients.size;
  }
}
