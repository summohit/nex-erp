import { Controller, Get, Post, Put, Body, Param, UseGuards, Request, Query, ForbiddenException } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('permissions')
@UseGuards(AuthGuard, PermissionsGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  getAllPermissions(@Request() req: any, @Query('role') role?: string) {
    if (role) {
      return this.permissionsService.getPermissions(req.user.companyId, role);
    }
    return this.permissionsService.getAllPermissions(req.user.companyId);
  }

  @Post()
  @Permissions('settings/permissions')
  setPermission(@Request() req: any, @Body() body: { role: string, module: string, action: string, enabled: boolean }) {
    if (req.user.role !== 'SUPERADMIN' && req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Only Administrators can update role permissions');
    }
    if (this.permissionsService.isSuperadminOnlyModule(body.module) && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Only the super admin can change Website Chat access');
    }
    return this.permissionsService.setPermission(
      req.user.companyId,
      body.role,
      body.module,
      body.action,
      body.enabled
    );
  }

  /** Website Chat tabs the signed-in user may open — drives the route guard. */
  @Get('website-chat/me')
  websiteChatMe(@Request() req: any) {
    return this.permissionsService
      .websiteChatTabs(req.user.companyId, req.user.sub, req.user.role)
      .then((tabs) => ({ tabs }));
  }

  @Get('website-chat/users')
  websiteChatUsers(@Request() req: any) {
    this.assertSuperadmin(req);
    return this.permissionsService.websiteChatUserAccess(req.user.companyId);
  }

  @Put('website-chat/users/:userId')
  setWebsiteChatUser(@Request() req: any, @Param('userId') userId: string, @Body() body: { granted: boolean | null }) {
    this.assertSuperadmin(req);
    const granted = body?.granted === true ? true : body?.granted === false ? false : null;
    return this.permissionsService.setUserModuleAccess(req.user.companyId, Number(userId), 'website-chat', granted);
  }

  private assertSuperadmin(req: any) {
    if (req.user.role !== 'SUPERADMIN') throw new ForbiddenException('Only the super admin can manage Website Chat access');
  }
}
