import { Controller, Get, Put, Body, Param, Query, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthGuard } from '../auth/auth.guard';

@UseGuards(AuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  async getMyNotifications(
    @Req() req: any,
    @Query('type') type?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const userId = this.extractUserId(req);
    return this.notificationsService.getUserNotifications(userId, {
      type: type || undefined,
      unreadOnly: unreadOnly === 'true',
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 50,
    });
  }

  @Get('types')
  async getTypes(@Req() req: any) {
    return this.notificationsService.getUserNotificationTypes(this.extractUserId(req));
  }

  // Registered before ':id/read' — "preferences" would otherwise be parsed as an id.
  @Get('preferences')
  async getPreferences(@Req() req: any) {
    return this.notificationsService.getPreferences(this.extractUserId(req));
  }

  @Put('preferences')
  async setPreference(@Req() req: any, @Body() body: { type: string; muted: boolean }) {
    return this.notificationsService.setPreference(
      this.extractUserId(req),
      body?.type,
      !!body?.muted,
    );
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
