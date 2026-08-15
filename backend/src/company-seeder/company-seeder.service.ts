import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompanySeederService implements OnModuleInit {
  private readonly logger = new Logger(CompanySeederService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    // Automatically seed all existing companies when the application starts up
    // Disabled by default to prevent long startup times.
    // Uncomment or run manually if you need to re-seed all companies.
    
    // try {
    //   this.logger.log('Starting company default data verification & seeding...');
    //   await this.seedAllExistingCompanies();
    //   this.logger.log('Company default data seeding completed.');
    // } catch (error) {
    //   this.logger.error('Failed to seed existing companies during module init:', error);
    // }
  }

  async seedAllExistingCompanies() {
    const companies = await this.prisma.company.findMany({ select: { id: true, name: true } });
    for (const company of companies) {
      await this.seedCompanyDefaults(company.id);
    }
  }

  async seedCompanyDefaults(companyId: number) {
    this.logger.log(`Seeding default data for Company ID: ${companyId}`);

    // 1. Seed Default Branch
    const existingBranch = await this.prisma.branch.findFirst({ where: { companyId } });
    if (!existingBranch) {
      await this.prisma.branch.create({
        data: {
          name: 'Head Office',
          address: 'Main Corporate Office',
          startTime: '09:00',
          endTime: '18:00',
          weeklyOffs: '0', // Sunday
          companyId,
        },
      });
    }

    // 2. Seed Default Departments & Designations
    const defaultDepts = [
      { name: 'Engineering', designations: ['Software Engineer', 'Senior Developer', 'Tech Lead', 'Engineering Manager'] },
      { name: 'Human Resources', designations: ['HR Executive', 'HR Manager', 'Talent Acquisition Specialist'] },
      { name: 'Finance & Accounts', designations: ['Accountant', 'Finance Analyst', 'Finance Manager'] },
      { name: 'Sales & Marketing', designations: ['Sales Executive', 'Marketing Lead', 'Business Development Manager'] },
      { name: 'Operations', designations: ['Operations Lead', 'Office Admin'] },
    ];

    for (const deptData of defaultDepts) {
      let dept = await this.prisma.department.findFirst({
        where: { companyId, name: deptData.name },
      });

      if (!dept) {
        dept = await this.prisma.department.create({
          data: {
            name: deptData.name,
            companyId,
          },
        });
      }

      for (const desigName of deptData.designations) {
        const desig = await this.prisma.designation.findFirst({
          where: { companyId, name: desigName },
        });
        if (!desig) {
          await this.prisma.designation.create({
            data: {
              name: desigName,
              departmentId: dept.id,
              companyId,
            },
          });
        }
      }
    }

    // 3. Seed Default Shifts
    const existingShift = await this.prisma.shift.findFirst({ where: { companyId } });
    if (!existingShift) {
      await this.prisma.shift.create({
        data: {
          name: 'General Shift (09:00 AM - 06:00 PM)',
          startTime: '09:00',
          endTime: '18:00',
          companyId,
        },
      });
    }

    // 4. Seed Default Leave Types
    const defaultLeaveTypes = [
      { name: 'Casual Leave (CL)', description: 'For urgent personal matters', defaultDays: 12, isPaid: true, carryForward: false },
      { name: 'Sick Leave (SL)', description: 'For medical issues and recovery', defaultDays: 10, isPaid: true, carryForward: false },
      { name: 'Earned Leave (EL)', description: 'Annual paid vacation leave', defaultDays: 15, isPaid: true, carryForward: true, carryForwardLimit: 5 },
      { name: 'Maternity Leave', description: 'Paid maternity leave for female employees', defaultDays: 180, isPaid: true, carryForward: false },
      { name: 'Paternity Leave', description: 'Paid paternity leave for male employees', defaultDays: 15, isPaid: true, carryForward: false },
      { name: 'Unpaid Leave (LOP)', description: 'Loss of pay leave', defaultDays: 0, isPaid: false, carryForward: false },
    ];

    for (const lt of defaultLeaveTypes) {
      const existing = await this.prisma.leaveType.findFirst({
        where: { companyId, name: lt.name },
      });
      if (!existing) {
        await this.prisma.leaveType.create({
          data: {
            name: lt.name,
            description: lt.description,
            defaultDays: lt.defaultDays,
            isPaid: lt.isPaid,
            carryForward: lt.carryForward,
            carryForwardLimit: lt.carryForwardLimit || 0,
            companyId,
          },
        });
      }
    }

    // 5. Seed Default Holidays (Current Year)
    const currentYear = new Date().getFullYear();
    const defaultHolidays = [
      { name: "New Year's Day", date: new Date(`${currentYear}-01-01`) },
      { name: 'Labor Day', date: new Date(`${currentYear}-05-01`) },
      { name: 'Independence Day', date: new Date(`${currentYear}-08-15`) },
      { name: 'Christmas Day', date: new Date(`${currentYear}-12-25`) },
    ];

    for (const h of defaultHolidays) {
      const existing = await this.prisma.holiday.findFirst({
        where: { companyId, name: h.name },
      });
      if (!existing) {
        await this.prisma.holiday.create({
          data: {
            name: h.name,
            date: h.date,
            companyId,
          },
        });
      }
    }

    // 6. Seed Default Award Types
    const defaultAwards = [
      { title: 'Employee of the Month', icon: 'trophy', color: 'orange' },
      { title: 'Star Performer', icon: 'star', color: 'purple' },
      { title: 'Team Player Award', icon: 'award', color: 'blue' },
    ];

    for (const award of defaultAwards) {
      const existing = await this.prisma.awardType.findFirst({
        where: { companyId, title: award.title },
      });
      if (!existing) {
        await this.prisma.awardType.create({
          data: {
            title: award.title,
            icon: award.icon,
            color: award.color,
            status: true,
            companyId,
          },
        });
      }
    }

    // 7. Seed Default Assets
    const defaultAssets = [
      { name: 'MacBook Pro 16"', assetTag: `AST-${companyId}-001`, category: 'LAPTOP', serialNumber: `MBP-${companyId}-001`, status: 'AVAILABLE' },
      { name: 'Dell UltraSharp 27" Monitor', assetTag: `AST-${companyId}-002`, category: 'MONITOR', serialNumber: `DEL-${companyId}-001`, status: 'AVAILABLE' },
      { name: 'Ergonomic Office Chair', assetTag: `AST-${companyId}-003`, category: 'OTHER', serialNumber: `CHR-${companyId}-001`, status: 'AVAILABLE' },
      { name: 'Logitech Wireless Keyboard & Mouse', assetTag: `AST-${companyId}-004`, category: 'PERIPHERAL', serialNumber: `LOG-${companyId}-001`, status: 'AVAILABLE' },
    ];

    for (const asset of defaultAssets) {
      const existing = await this.prisma.asset.findFirst({
        where: { companyId, name: asset.name },
      });
      if (!existing) {
        await this.prisma.asset.create({
          data: {
            name: asset.name,
            assetTag: asset.assetTag,
            category: asset.category,
            serialNumber: asset.serialNumber,
            status: asset.status,
            companyId,
          },
        });
      }
    }

    // 8. Seed Default Role Permissions
    const rolePermissions: Record<string, string[]> = {
      ADMIN: [
        'employees', 'employees/directory', 'employees/org-chart', 'employees/onboarding', 'employees/documents',
        'recruitment', 'recruitment/jobs', 'recruitment/candidates', 'recruitment/interviews', 'recruitment/careers-page',
        'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/shifts', 'attendance/holidays',
        'payroll', 'payroll/processing', 'payroll/payslips', 'payroll/expenses', 'payroll/taxes',
        'assets', 'assets/inventory', 'assets/assignments', 'assets/requests',
        'settings', 'settings/company', 'settings/master-data', 'settings/permissions', 'settings/integrations',
        'projects'
      ],
      HR: [
        'employees', 'employees/directory', 'employees/org-chart', 'employees/onboarding', 'employees/documents',
        'recruitment', 'recruitment/jobs', 'recruitment/candidates', 'recruitment/interviews', 'recruitment/careers-page',
        'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/shifts', 'attendance/holidays',
        'payroll', 'payroll/processing', 'payroll/payslips',
        'projects'
      ],
      FINANCE: [
        'employees', 'employees/directory', 'employees/org-chart',
        'recruitment', 'recruitment/careers-page',
        'attendance', 'attendance/timesheets',
        'payroll', 'payroll/processing', 'payroll/payslips', 'payroll/expenses', 'payroll/taxes',
        'assets', 'assets/inventory', 'assets/assignments',
        'projects'
      ],
      SALES: [
        'employees', 'employees/org-chart',
        'recruitment', 'recruitment/careers-page',
        'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/holidays',
        'payroll', 'payroll/payslips', 'payroll/expenses',
        'projects'
      ],
      EMPLOYEE: [
        'employees', 'employees/org-chart',
        'recruitment', 'recruitment/interviews', 'recruitment/careers-page',
        'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/holidays',
        'payroll', 'payroll/payslips', 'payroll/expenses', 'payroll/taxes',
        'assets', 'assets/requests',
        'projects'
      ]
    };

    for (const [role, modules] of Object.entries(rolePermissions)) {
      for (const module of modules) {
        const existing = await this.prisma.rolePermission.findFirst({
          where: { companyId, role, module, action: 'VIEW' },
        });
        if (!existing) {
          await this.prisma.rolePermission.create({
            data: {
              role,
              module,
              action: 'VIEW',
              companyId,
            },
          });
        }
      }
    }
  }
}
