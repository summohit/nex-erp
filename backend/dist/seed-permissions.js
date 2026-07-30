"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    host: '/tmp',
    port: 5432,
    user: 'mohitsingh',
    database: 'erp_db'
});
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    const company = await prisma.company.findFirst();
    if (!company) {
        console.error('No company found to seed permissions for.');
        return;
    }
    const companyId = company.id;
    const rolePermissions = {
        'ADMIN': [
            'employees', 'employees/directory', 'employees/org-chart', 'employees/onboarding', 'employees/documents',
            'recruitment', 'recruitment/jobs', 'recruitment/candidates', 'recruitment/interviews',
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
            'assets', 'assets/requests'
        ]
    };
    for (const [role, modules] of Object.entries(rolePermissions)) {
        console.log(`Seeding permissions for ${role}...`);
        for (const module of modules) {
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
//# sourceMappingURL=seed-permissions.js.map