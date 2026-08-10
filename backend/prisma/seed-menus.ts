import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://mohitsingh@localhost:5432/erp_db?host=/tmp',
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const menuSections = [
  {
    title: 'MAIN',
    items: [
      {
        id: 'overview',
        title: 'Dashboard',
        icon: 'lucideLayoutDashboard',
        route: '/dashboard'
      },
      {
        id: 'employees',
        title: 'Employees',
        icon: 'lucideUsers',
        route: '/employees',
        subItems: [
          { id: 'employees/directory', title: 'Employee Directory', route: '/employees/directory' },
          { id: 'employees/me/profile', title: 'My Profile', route: '/employees/me/profile' },
          { id: 'employees/org-chart', title: 'Organization Chart', route: '/employees/org-chart' },
          { id: 'employees/onboarding', title: 'Onboarding', route: '/employees/onboarding' },
          { id: 'employees/documents', title: 'Documents', route: '/employees/documents' }
        ]
      },
      {
        id: 'recruitment',
        title: 'Recruitment',
        icon: 'lucideBriefcase',
        route: '/recruitment',
        subItems: [
          { id: 'recruitment/jobs', title: 'Job Postings', route: '/recruitment/jobs' },
          { id: 'recruitment/candidates', title: 'Candidates (ATS)', route: '/recruitment/candidates' },
          { id: 'recruitment/interviews', title: 'Interviews', route: '/recruitment/interviews' },
          { id: 'recruitment/careers', title: 'Public Careers Page ↗', route: '/careers', external: true }
        ]
      },
      {
        id: 'projects',
        title: 'Projects',
        icon: 'lucideKanban',
        route: '/projects'
      },
      {
        id: 'attendance',
        title: 'Attendance & Leave',
        icon: 'lucideCalendarClock',
        route: '/attendance',
        subItems: [
          { id: 'attendance/timesheets', title: 'Timesheets', route: '/attendance/timesheets' },
          { id: 'attendance/leaves', title: 'Time Off Requests', route: '/attendance/leaves' },
          { id: 'attendance/approvals', title: 'Leave Approvals', route: '/attendance/approvals' },
          { id: 'attendance/balances', title: 'Leave Balances', route: '/attendance/balances' },
          { id: 'attendance/shifts', title: 'Shift Roster', route: '/attendance/shifts' },
          { id: 'attendance/timeline', title: 'Team Timeline', route: '/attendance/timeline' },
          { id: 'attendance/holidays', title: 'Holidays', route: '/attendance/holidays' }
        ]
      },
      {
        id: 'appreciation',
        title: 'Appreciation',
        icon: 'lucideTrophy',
        route: '/appreciation'
      },
      {
        id: 'payroll',
        title: 'Payroll & Expenses',
        icon: 'lucideBanknote',
        route: '/payroll',
        subItems: [
          { id: 'payroll/processing', title: 'Salary Processing', route: '/payroll/processing' },
          { id: 'payroll/payslips', title: 'Payslips', route: '/payroll/payslips' },
          { id: 'payroll/expenses', title: 'Expense Claims', route: '/payroll/expenses' },
          { id: 'payroll/structure', title: 'Salary Structure', route: '/payroll/structure' }
        ]
      },
      {
        id: 'assets',
        title: 'Assets & IT',
        icon: 'lucideLaptop',
        route: '/assets',
        subItems: [
          { id: 'assets/inventory', title: 'Asset Inventory', route: '/assets/inventory' },
          { id: 'assets/assignments', title: 'Assignments', route: '/assets/assignments' },
          { id: 'assets/requests', title: 'Hardware Requests', route: '/assets/requests' }
        ]
      }
    ]
  },
  {
    title: 'OTHERS',
    items: [
      {
        id: 'settings',
        title: 'Settings',
        icon: 'lucideSettings',
        route: '/settings',
        subItems: [
          { id: 'settings/company', title: 'Company Profile', route: '/settings/company' },
          { id: 'settings/master-data', title: 'Master Data', route: '/settings/master-data' },
          { id: 'settings/permissions', title: 'Roles & Permissions', route: '/settings/permissions' },
          { id: 'settings/integrations', title: 'Integrations', route: '/settings/integrations' }
        ]
      }
    ]
  }
];

async function seedMenus() {
  console.log('Seeding menus...');
  
  // Clear existing system menus (companyId = null)
  await prisma.menu.deleteMany({ where: { companyId: null } });

  let displayOrder = 0;

  for (const section of menuSections) {
    // We treat sections as top-level headers (parents)
    const sectionMenu = await prisma.menu.create({
      data: {
        companyId: null, // Global
        title: section.title,
        isActive: true,
        displayOrder: displayOrder++
      }
    });

    let itemOrder = 0;
    for (const item of section.items) {
      const parentMenu = await prisma.menu.create({
        data: {
          companyId: null,
          parentId: sectionMenu.id,
          title: item.title,
          icon: item.icon,
          route: item.route,
          isActive: true,
          displayOrder: itemOrder++
        }
      });

      if (item.subItems) {
        let subItemOrder = 0;
        for (const subItem of item.subItems) {
          await prisma.menu.create({
            data: {
              companyId: null,
              parentId: parentMenu.id,
              title: subItem.title,
              route: subItem.route,
              externalUrl: subItem.external ? subItem.route : null,
              openInNewTab: !!subItem.external,
              isActive: true,
              displayOrder: subItemOrder++
            }
          });
        }
      }
    }
  }

  console.log('Menus seeded successfully.');
}

seedMenus()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
