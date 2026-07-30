import { Controller, Get, Post, Body, Param, UseGuards, Request, Query } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('permissions')
@UseGuards(AuthGuard)
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
  setPermission(@Request() req: any, @Body() body: { role: string, module: string, action: string, enabled: boolean }) {
    // Only Admin/HR should ideally be able to do this, but for now we just rely on JWT
    // In a real app we'd add an admin guard here.
    return this.permissionsService.setPermission(
      req.user.companyId,
      body.role,
      body.module,
      body.action,
      body.enabled
    );
  }
}
