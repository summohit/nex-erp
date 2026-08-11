import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MenusService implements OnModuleInit {
  private readonly logger = new Logger(MenusService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try {
      const parent = await this.prisma.menu.findFirst({ where: { parentId: null, title: 'MAIN' } });
      if (parent) {
        const perfMenu = await this.prisma.menu.findFirst({ where: { title: 'Performance', parentId: parent.id } });
        if (!perfMenu) {
          await this.prisma.menu.create({
            data: {
              title: 'Performance',
              icon: 'target',
              route: '/performance',
              displayOrder: 4,
              parentId: parent.id,
              isActive: true
            }
          });
          this.logger.log('Performance menu auto-seeded successfully.');
        }

        const offMenu = await this.prisma.menu.findFirst({ where: { title: 'Offboarding', parentId: parent.id } });
        if (!offMenu) {
          await this.prisma.menu.create({
            data: {
              title: 'Offboarding',
              icon: 'door-open', // generic lucide door-open icon
              route: '/offboarding',
              displayOrder: 5,
              parentId: parent.id,
              isActive: true
            }
          });
          this.logger.log('Offboarding menu auto-seeded successfully.');
        }

        const clientsMenu = await this.prisma.menu.findFirst({ where: { title: 'Clients', parentId: parent.id } });
        if (!clientsMenu) {
          await this.prisma.menu.create({
            data: {
              title: 'Clients',
              icon: 'building', 
              route: '/clients',
              displayOrder: 6,
              parentId: parent.id,
              isActive: true
            }
          });
          this.logger.log('Clients menu auto-seeded successfully.');
        }
      }

      // Also ensure Payroll Rules is under Settings
      const settingsParent = await this.prisma.menu.findFirst({ where: { title: 'Settings', parentId: { not: null } } });
      if (settingsParent) {
        const payrollRulesMenu = await this.prisma.menu.findFirst({ where: { title: 'Payroll Rules', parentId: settingsParent.id } });
        if (!payrollRulesMenu) {
          await this.prisma.menu.create({
            data: {
              title: 'Payroll Rules',
              route: '/settings/payroll',
              displayOrder: 10,
              parentId: settingsParent.id,
              isActive: true
            }
          });
          this.logger.log('Payroll Rules menu auto-seeded successfully.');
        }
      }
    } catch (err) {
      this.logger.error('Failed to auto-seed menus:', err);
    }
  }


  async getSidebarMenus(companyId: number, userId: number, roleName: string) {
    // 1. Fetch all active menus (system global + company specific)
    const menus = await this.prisma.menu.findMany({
      where: {
        isActive: true,
        OR: [
          { companyId: null },
          { companyId: companyId }
        ]
      },
      include: {
        children: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
          include: {
            children: {
              where: { isActive: true },
              orderBy: { displayOrder: 'asc' }
            }
          }
        }
      },
      orderBy: { displayOrder: 'asc' }
    });

    // 2. Filter top-level sections
    const tree = menus.filter(m => m.parentId === null);
    
    // 3. Format it to match the JSON structure expected by frontend
    return tree.map(section => ({
      title: section.title,
      items: section.children.map(item => ({
        id: item.route ? item.route.replace('/', '') : item.title.toLowerCase().replace(/ /g, '-'),
        title: item.title,
        icon: item.icon,
        route: item.route,
        subItems: item.children.length > 0 ? item.children.map(sub => ({
          id: sub.route ? sub.route.replace('/', '') : sub.title.toLowerCase().replace(/ /g, '-'),
          title: sub.title,
          route: sub.route,
          external: sub.openInNewTab
        })) : undefined
      }))
    }));
  }
}
