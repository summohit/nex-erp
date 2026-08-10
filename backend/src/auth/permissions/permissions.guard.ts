import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, PermissionRequirement } from '../require-permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<PermissionRequirement[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    
    if (!user) {
      throw new ForbiddenException('User is not authenticated');
    }

    if (user.role === 'SUPER_ADMIN') {
      return true;
    }

    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true
              }
            }
          }
        }
      }
    });

    const grantedPermissions = userRoles.flatMap(ur => ur.role.permissions);

    const hasAllPermissions = requiredPermissions.every(reqPerm => {
      return grantedPermissions.some(gp => 
        gp.permission.resourceType === reqPerm.resourceType &&
        gp.permission.action === reqPerm.action &&
        gp.effect === 'ALLOW'
      );
    });

    if (!hasAllPermissions) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
