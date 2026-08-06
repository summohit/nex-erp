import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, PermissionRequirement } from '../decorators/permissions.decorator';
import { PermissionsService } from '../../permissions/permissions.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<PermissionRequirement[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true; // No permission requirement set on endpoint
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('User session not authenticated');
    }

    // SUPERADMIN has unrestricted access across all companies and modules
    if (user.role === 'SUPERADMIN') {
      return true;
    }

    const companyId = user.companyId;
    const userRole = user.role || 'EMPLOYEE';

    // ADMIN role has default access to standard company management endpoints
    if (userRole === 'ADMIN') {
      return true;
    }

    for (const req of requiredPermissions) {
      const action = req.action || 'VIEW';
      const hasPerm = await this.permissionsService.hasPermission(
        companyId,
        userRole,
        req.module,
        action,
      );

      if (hasPerm) {
        return true;
      }
    }

    throw new ForbiddenException('Access Denied: You do not have permission to execute this operation.');
  }
}
