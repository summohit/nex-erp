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
        const crmMenu = await this.prisma.menu.findFirst({ where: { title: 'CRM', parentId: parent.id } });
        if (!crmMenu) {
          await this.prisma.menu.create({
            data: {
              title: 'CRM',
              icon: 'funnel', 
              route: '/crm/leads',
              displayOrder: 7,
              parentId: parent.id,
              isActive: true
            }
          });
          this.logger.log('CRM menu auto-seeded successfully.');
        }

        const salesMenu = await this.prisma.menu.findFirst({ where: { title: 'Sales', parentId: parent.id } });
        if (!salesMenu) {
          const salesParent = await this.prisma.menu.create({
            data: {
              title: 'Sales',
              icon: 'shopping-cart',
              displayOrder: 8,
              parentId: parent.id,
              isActive: true
            }
          });
          
          await this.prisma.menu.createMany({
            data: [
              { title: 'Quotations', route: '/sales/quotations', displayOrder: 1, parentId: salesParent.id, isActive: true },
              { title: 'Sales Orders', route: '/sales/orders', displayOrder: 2, parentId: salesParent.id, isActive: true },
              { title: 'Point of Sale', route: '/sales/pos', displayOrder: 3, parentId: salesParent.id, isActive: true }
            ]
          });
          this.logger.log('Sales menu auto-seeded successfully.');
        }
        
        // Tickets is reached from the header (next to Create), not the sidebar.
        // Deactivate any Tickets rows left behind by earlier seeds.
        const { count: deactivated } = await this.prisma.menu.updateMany({
          where: { route: '/crm/tickets', isActive: true },
          data: { isActive: false },
        });
        if (deactivated > 0) {
          this.logger.log(`Removed ${deactivated} Tickets menu entry from the sidebar.`);
        }

        // Ensure Leads stays as a CRM sub-item
        const crmParent = await this.prisma.menu.findFirst({ where: { title: 'CRM', parentId: parent.id } });
        if (crmParent) {
          const leadsSubMenu = await this.prisma.menu.findFirst({ where: { title: 'Leads', parentId: crmParent.id } });
          if (!leadsSubMenu && crmParent.route) {
            await this.prisma.menu.create({
              data: {
                title: 'Leads',
                icon: 'funnel',
                route: '/crm/leads',
                displayOrder: 1,
                parentId: crmParent.id,
                isActive: true,
              },
            });
            await this.prisma.menu.update({ where: { id: crmParent.id }, data: { route: null } });
          }
        }

        // Follow-Ups menu is now accessible via the CRM Leads Board, not the sidebar
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

      // Also ensure Lead Forms is under CRM
      const crmSection = await this.prisma.menu.findFirst({ where: { title: 'CRM', parentId: { not: null } } });
      if (crmSection) {
        const leadFormsMenu = await this.prisma.menu.findFirst({ where: { title: 'Lead Forms', parentId: crmSection.id } });
        if (!leadFormsMenu) {
          await this.prisma.menu.create({
            data: {
              title: 'Lead Forms',
              route: '/crm/lead-forms',
              displayOrder: 20,
              parentId: crmSection.id,
              isActive: true
            }
          });
          this.logger.log('Lead Forms menu auto-seeded successfully.');
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

    // 2. Format to JSON structure
    const tree = menus.filter(m => m.parentId === null);
    
    let formattedMenus = tree.map(section => ({
      title: section.title,
      items: section.children.map(item => ({
        id: item.route ? item.route.replace('/', '') : item.title.toLowerCase().replace(/ /g, '-'),
        title: item.title,
        icon: item.icon,
        route: item.route,
        subItems: item.children.length > 0 ? item.children.map(sub => ({
          id: sub.route === '/careers' ? 'recruitment/careers-page' : (sub.route ? sub.route.replace('/', '') : sub.title.toLowerCase().replace(/ /g, '-')),
          title: sub.title,
          route: sub.route,
          external: sub.openInNewTab
        })) : undefined
      }))
    }));

    // 3. Superadmin gets everything
    if (roleName === 'SUPERADMIN') {
      // Add 'overview' implicitly as it's the dashboard
      return formattedMenus;
    }

    // 4. Fetch RolePermissions for standard roles
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { companyId, role: roleName, action: 'VIEW' }
    });
    
    const allowedModules = new Set(rolePermissions.map(p => p.module));
    
    // Always allow overview (dashboard), profile, and tickets (all employees can raise/view tickets)
    allowedModules.add('overview');
    allowedModules.add('employees/me/profile');
    allowedModules.add('dashboard');
    allowedModules.add('crm/tickets');

    // If role has NO permissions defined yet, apply a safe default fallback
    if (rolePermissions.length === 0) {
      if (['ADMIN', 'HR', 'FINANCE'].includes(roleName)) {
        ['assets', 'assets/inventory', 'assets/assignments', 'assets/requests', 'clients', 'careers'].forEach(m => allowedModules.add(m));
      } else {
        ['assets', 'assets/requests', 'careers'].forEach(m => allowedModules.add(m));
      }
    }

    // 5. Filter the formatted menus
    const filteredMenus = formattedMenus.map(section => {
      // Filter items in section
      const validItems = section.items.filter(item => {
        // If it has subitems, keep it if AT LEAST ONE subitem is allowed
        if (item.subItems && item.subItems.length > 0) {
          item.subItems = item.subItems.filter(sub => allowedModules.has(sub.id));
          return item.subItems.length > 0;
        }
        // If no subitems, check if parent itself is allowed
        return allowedModules.has(item.id) || item.id === 'overview';
      });

      return {
        ...section,
        items: validItems
      };
    }).filter(section => section.items.length > 0);

    return filteredMenus;
  }
}
