import { Controller, Get, Put, Post, Delete, Body, Param, Query, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DeviceTokensService } from './push/device-tokens.service';
import { PushService } from './push/push.service';
import { AuthGuard } from '../auth/auth.guard';

@UseGuards(AuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private notificationsService: NotificationsService,
    private deviceTokens: DeviceTokensService,
    private push: PushService,
  ) {}

  /**
   * The browser's Firebase config, served rather than compiled in.
   *
   * Keeps the whole setup to one file on the server: changing Firebase project,
   * or configuring one for the first time, needs no Angular rebuild and no .env
   * edit. Returns only the public web values — see PushService.getWebConfig,
   * which lists them field by field precisely so the service account's private
   * key in the same file can never be spread into this response.
   */
  @Get('push-config')
  async pushConfig() {
    return this.push.getWebConfig();
  }

  // ── push devices ─────────────────────────────────────────────────────────
  //
  // Registered before ':id/read' for the same reason 'preferences' is: a path
  // segment that is not a number must be matched before the :id route claims it.

  /**
   * Called on every app launch, not just the first — FCM rotates registration
   * tokens on its own schedule, and a client that registers once quietly stops
   * receiving anything.
   */
  @Post('devices')
  async registerDevice(
    @Req() req: any,
    @Body() body: { token: string; platform: string; deviceName?: string },
  ) {
    return this.deviceTokens.register(this.extractUserId(req), req.user.companyId, body);
  }

  /** On sign-out, so the next person on this device does not get these pushes. */
  @Delete('devices')
  async unregisterDevice(@Req() req: any, @Body() body: { token: string }) {
    return this.deviceTokens.unregister(this.extractUserId(req), body?.token);
  }

  @Get('devices')
  async listDevices(@Req() req: any) {
    return this.deviceTokens.list(this.extractUserId(req));
  }

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
