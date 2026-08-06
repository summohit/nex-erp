import { Controller, Get, Post, Body, Param, UseGuards, Request, Query, ForbiddenException } from '@nestjs/common';
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
    return this.permissionsService.setPermission(
      req.user.companyId,
      body.role,
      body.module,
      body.action,
      body.enabled
    );
  }
}
