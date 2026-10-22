import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
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

/**
 * Website Chat is off for everyone but the super admin until the super admin
 * adds them on the Website Chat Access tab (UserModuleAccess). Unlike
 * other modules there is no ADMIN fallback: chats hold visitors' contact
 * details and the super admin decides who reads them.
 */
export const WEBSITE_CHAT_MODULE = 'website-chat';
export const WEBSITE_CHAT_TABS = ['website-chat/inbox', 'website-chat/knowledge-base', 'website-chat/widgets'];
/** Modules only the super admin may grant, by role or by person. */
const SUPERADMIN_ONLY_MODULES = [WEBSITE_CHAT_MODULE, ...WEBSITE_CHAT_TABS];

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

  isSuperadminOnlyModule(module: string) {
    return SUPERADMIN_ONLY_MODULES.includes(module);
  }

  /**
   * Which Website Chat tabs this user may open (empty = no access). Only the
   * super admin and people the super admin added on the Website Chat Access
   * tab get in — roles never grant it.
   */
  async websiteChatTabs(companyId: number, userId: number, role: string): Promise<string[]> {
    if (role === 'SUPERADMIN') return [...WEBSITE_CHAT_TABS];
    if (!userId) return [];
    const override = await this.prisma.userModuleAccess.findUnique({
      where: { userId_module: { userId, module: WEBSITE_CHAT_MODULE } },
    });
    return override?.granted ? [...WEBSITE_CHAT_TABS] : [];
  }

  /** Employee ids of active users who can open the Website Chat inbox — who to alert when a visitor needs a person. */
  async websiteChatInboxEmployeeIds(companyId: number): Promise<number[]> {
    const users = await this.prisma.user.findMany({
      where: {
        companyId,
        status: { not: 'SUSPENDED' },
        employee: { isNot: null },
        OR: [
          { role: 'SUPERADMIN' },
          { moduleAccess: { some: { module: WEBSITE_CHAT_MODULE, granted: true } } },
        ],
      },
      select: { employee: { select: { id: true } } },
    });
    return users.map((u) => u.employee?.id).filter((id): id is number => !!id);
  }

  /** Everyone in the company with their Website Chat access, for the super admin's per-user panel. */
  async websiteChatUserAccess(companyId: number) {
    const users = await this.prisma.user.findMany({
      where: { companyId },
      select: {
        id: true, email: true, role: true, status: true,
        employee: {
          select: {
            firstName: true,
            lastName: true,
            avatarUrl: true,
            designation: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        moduleAccess: { where: { module: WEBSITE_CHAT_MODULE }, select: { granted: true } },
      },
      orderBy: { email: 'asc' },
    });
    return users.map((u) => {
      const override = u.moduleAccess[0]?.granted;
      const fromRole = u.role === 'SUPERADMIN';
      return {
        userId: u.id,
        name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.email,
        email: u.email,
        role: u.role,
        avatarUrl: u.employee?.avatarUrl || null,
        designation: u.employee?.designation?.name || null,
        department: u.employee?.department?.name || null,
        // Inactive in this app means a SUSPENDED account (see timesheets.service).
        isActive: u.status !== 'SUSPENDED',
        fromRole,
        override: override === undefined ? null : override,
        hasAccess: u.role === 'SUPERADMIN' ? true : override ?? fromRole,
      };
    });
  }

  /** granted: true = show, false = hide, null = follow the role again. */
  async setUserModuleAccess(companyId: number, userId: number, module: string, granted: boolean | null) {
    if (module !== WEBSITE_CHAT_MODULE) throw new BadRequestException('Per-user access is only available for Website Chat.');
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId }, select: { id: true, role: true, status: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'SUPERADMIN') throw new BadRequestException('Super admins always have access.');
    if (granted === true && user.status === 'SUSPENDED') throw new BadRequestException('This user is inactive.');
    if (granted === null) {
      await this.prisma.userModuleAccess.deleteMany({ where: { userId, module } });
    } else {
      await this.prisma.userModuleAccess.upsert({
        where: { userId_module: { userId, module } },
        update: { granted },
        create: { userId, module, granted },
      });
    }
    return { success: true };
  }
}
