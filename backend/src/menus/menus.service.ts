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
        
        // ── Delivery ───────────────────────────────────────────────────
        // Projects is a section, not a link: Projects, Tasks, Timesheet and
        // Client Visits live under it. Reconciled on every boot rather than
        // seeded once, so an install that predates the Delivery module and one
        // created from prisma/seed-menus.ts converge on the same sidebar.
        //
        // Project Tickets and Project Reports are deliberately absent until
        // the screens behind them exist — a menu row that leads nowhere is
        // worse than a missing one.
        const deliveryMenu = await this.prisma.menu.findFirst({
          where: { parentId: parent.id, OR: [{ title: 'Delivery' }, { route: '/projects' }] },
        });

        if (deliveryMenu) {
          if (deliveryMenu.title !== 'Delivery' || deliveryMenu.route !== null) {
            await this.prisma.menu.update({
              where: { id: deliveryMenu.id },
              // Route cleared: a parent that is both a link and a section
              // renders as a dead click target once it has children, which is
              // why CRM was given the same treatment.
              data: { title: 'Delivery', route: null, icon: deliveryMenu.icon || 'kanban' },
            });
            this.logger.log('Projects menu promoted to the Delivery section.');
          }

          const deliveryChildren = [
            { title: 'Projects', route: '/projects', displayOrder: 1 },
            { title: 'Tasks', route: '/tasks', displayOrder: 2 },
            { title: 'Timesheet', route: '/timesheets', displayOrder: 3 },
            { title: 'Client Visits', route: '/field-visits', displayOrder: 4 },
            // §4: additional-hours requests across every project.
            { title: 'Requests', route: '/task-requests', displayOrder: 5 },
          ];

          for (const child of deliveryChildren) {
            const existing = await this.prisma.menu.findFirst({
              where: { parentId: deliveryMenu.id, route: child.route },
            });
            if (existing) {
              const updates: any = {};
              if (!existing.isActive) updates.isActive = true;
              // Renamed in place so installs from before the rename converge on
              // "Client Visits" too, not just fresh seeds.
              if (existing.title !== child.title) updates.title = child.title;
              if (Object.keys(updates).length > 0) {
                await this.prisma.menu.update({ where: { id: existing.id }, data: updates });
              }
              continue;
            }
            await this.prisma.menu.create({
              data: { ...child, parentId: deliveryMenu.id, isActive: true },
            });
            this.logger.log(`Delivery > ${child.title} menu auto-seeded successfully.`);
          }

          // Client Visits used to sit beside Projects at the top level. Retire
          // the old row rather than leaving it in two places.
          const { count: movedFieldVisits } = await this.prisma.menu.updateMany({
            where: { route: '/field-visits', parentId: parent.id, isActive: true },
            data: { isActive: false },
          });
          if (movedFieldVisits > 0) {
            this.logger.log('Client Visits moved under Delivery.');
          }
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

          // Ensure Lead Contacts is a CRM sub-item directly below Leads
          const leadContactsSubMenu = await this.prisma.menu.findFirst({ where: { title: 'Lead Contacts', parentId: crmParent.id } });
          if (!leadContactsSubMenu) {
            await this.prisma.menu.create({
              data: {
                title: 'Lead Contacts',
                icon: 'funnel',
                route: '/crm/lead-contacts',
                displayOrder: 2,
                parentId: crmParent.id,
                isActive: true,
              },
            });
            this.logger.log('Lead Contacts menu auto-seeded successfully.');
          } else {
            // Existing installations may have an old/inactive row. Keep this
            // quick link visible and pointing at the CRM Lead Contacts view.
            await this.prisma.menu.update({
              where: { id: leadContactsSubMenu.id },
              data: { route: '/crm/lead-contacts', displayOrder: 2, isActive: true },
            });
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
    // Self-service account security (two-factor setup). Every role manages their
    // own, so it is granted alongside the profile rather than via RolePermission.
    allowedModules.add('settings/security');

    // The Delivery section's children all ride on the single 'projects'
    // permission. Renaming the sidebar entry must not quietly revoke access:
    // every role that could reach Projects before can reach all of Delivery
    // now, and there is nothing new for an administrator to grant.
    //
    // Field Visits was already doing this — a visit is always logged against a
    // project — and Tasks and Timesheet are the same work seen from a
    // different angle, not a separate permission surface.
    if (allowedModules.has('projects')) {
      ['field-visits', 'tasks', 'timesheets'].forEach((m) => allowedModules.add(m));
    }

    // The leave quota report is a read-only view of balances that the
    // attendance permission already covers, and the endpoint scopes anyone who
    // is not an admin or HR to their own row — so there is nothing extra for an
    // administrator to grant, and no separate module to invent.
    if (allowedModules.has('attendance')) allowedModules.add('attendance/leave-quota');

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
