import { Controller, Get, Put, Param, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  async getMyNotifications(@Req() req: any) {
    const userId = this.extractUserId(req);
    return this.notificationsService.getUserNotifications(userId);
  }

  @Put(':id/read')
  async markAsRead(@Param('id') id: string, @Req() req: any) {
    const userId = this.extractUserId(req);
    return this.notificationsService.markAsRead(Number(id), userId);
  }

  @Put('read-all')
  async markAllAsRead(@Req() req: any) {
    const userId = this.extractUserId(req);
    return this.notificationsService.markAllAsRead(userId);
  }

  private extractUserId(req: any): number {
    const user = req.user;
    if (!user || !user.sub) {
      throw new UnauthorizedException('User session required');
    }
    return user.sub;
  }
}
