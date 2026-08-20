import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Default sidebar access granted to the OFFICE_STAFF role the first time it's used.
// Auto-seeded once per company (idempotent) so the role shows up populated in the
// Permissions Matrix without needing a manual seed script run.
const OFFICE_STAFF_DEFAULT_MODULES = [
  'employees/me/profile',
  'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/holidays',
  'appreciation', 'appreciation/list', 'appreciation/types',
  'payroll', 'payroll/processing', 'payroll/payslips', 'payroll/expenses',
  'assets', 'assets/inventory', 'assets/assignments', 'assets/requests'
];

@Injectable()
export class PermissionsService implements OnModuleInit {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try {
      const existing = await this.prisma.rolePermission.findFirst({
        where: { role: 'OFFICE_STAFF' }
      });
      if (existing) return;

      const companies = await this.prisma.company.findMany({ select: { id: true } });
      for (const company of companies) {
        for (const module of OFFICE_STAFF_DEFAULT_MODULES) {
          await this.prisma.rolePermission.upsert({
            where: {
              role_module_action_companyId: {
                role: 'OFFICE_STAFF', module, action: 'VIEW', companyId: company.id
              }
            },
            update: {},
            create: {
              role: 'OFFICE_STAFF', module, action: 'VIEW', companyId: company.id
            }
          });
        }
      }
      this.logger.log('OFFICE_STAFF default permissions auto-seeded successfully.');
    } catch (err) {
      this.logger.error('Failed to auto-seed OFFICE_STAFF permissions:', err);
    }
  }

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
