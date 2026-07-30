import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  async getPermissions(companyId: number, role: string) {
    return this.prisma.rolePermission.findMany({
      where: { companyId, role }
    });
  }

  async getAllPermissions(companyId: number) {
    return this.prisma.rolePermission.findMany({
      where: { companyId }
    });
  }

  async setPermission(companyId: number, role: string, module: string, action: string, enabled: boolean) {
    if (enabled) {
      return this.prisma.rolePermission.upsert({
        where: {
          role_module_action_companyId: {
            role, module, action, companyId
          }
        },
        update: {},
        create: {
          role, module, action, companyId
        }
      });
    } else {
      return this.prisma.rolePermission.deleteMany({
        where: { role, module, action, companyId }
      });
    }
  }

  async hasPermission(companyId: number, role: string, module: string, action: string): Promise<boolean> {
    const perm = await this.prisma.rolePermission.findUnique({
      where: {
        role_module_action_companyId: {
          role, module, action, companyId
        }
      }
    });
    return !!perm;
  }
}
