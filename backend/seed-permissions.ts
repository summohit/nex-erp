import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  host: '/tmp',
  port: 5432,
  user: 'mohitsingh',
  database: 'erp_db'
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const company = await prisma.company.findFirst();
  if (!company) {
    console.error('No company found to seed permissions for.');
    return;
  }
  const companyId = company.id;

  // Define default permissions per role
  const rolePermissions: Record<string, string[]> = {
    'ADMIN': [
      'employees', 'employees/directory', 'employees/org-chart', 'employees/onboarding', 'employees/documents',
      'recruitment', 'recruitment/jobs', 'recruitment/candidates', 'recruitment/interviews',
      'projects', 'projects/all', 'projects/my-work',
      'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/shifts', 'attendance/holidays',
      'payroll', 'payroll/processing', 'payroll/payslips', 'payroll/expenses', 'payroll/taxes',
      'assets', 'assets/inventory', 'assets/assignments', 'assets/requests',
      'settings', 'settings/company', 'settings/master-data', 'settings/permissions', 'settings/integrations'
    ],
    'HR': [
      'employees', 'employees/directory', 'employees/org-chart', 'employees/onboarding', 'employees/documents',
      'recruitment', 'recruitment/jobs', 'recruitment/candidates', 'recruitment/interviews',
      'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/shifts', 'attendance/holidays',
      'payroll', 'payroll/processing', 'payroll/payslips'
    ],
    'FINANCE': [
      'employees', 'employees/directory', 'employees/org-chart',
      'attendance', 'attendance/timesheets',
      'payroll', 'payroll/processing', 'payroll/payslips', 'payroll/expenses', 'payroll/taxes',
      'assets', 'assets/inventory', 'assets/assignments'
    ],
    'SALES': [
      'employees', 'employees/directory', 'employees/org-chart',
      'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/holidays',
      'payroll', 'payroll/payslips', 'payroll/expenses'
    ],
    'EMPLOYEE': [
      'employees', 'employees/directory', 'employees/org-chart', 'employees/documents',
      'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/holidays',
      'payroll', 'payroll/payslips', 'payroll/expenses', 'payroll/taxes',
      'assets', 'assets/requests',
      'projects', 'projects/all', 'projects/my-work'
    ]
  };

  for (const [role, modules] of Object.entries(rolePermissions)) {
    console.log(`Seeding permissions for ${role}...`);
    for (const module of modules) {
      // Upsert to avoid duplicates
      const existing = await prisma.rolePermission.findFirst({
        where: { role, module, action: 'VIEW', companyId }
      });
      if (!existing) {
        await prisma.rolePermission.create({
          data: {
            role,
            module,
            action: 'VIEW',
            companyId
          }
        });
      }
    }
  }

  console.log('Default permissions seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
