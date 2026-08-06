import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsGateway: NotificationsGateway
  ) {}

  async getUserNotifications(userId: number) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });

    return { notifications, unreadCount };
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
}
