import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  async signupCompany(
    companyName: string, 
    domain: string, 
    adminEmail: string, 
    adminPassword: string,
    firstName: string,
    lastName: string,
    phone?: string
  ) {
    // 1. Check if domain or email already exists
    const existingCompany = await this.prisma.company.findUnique({ where: { domain } });
    if (existingCompany) throw new ConflictException('Company domain already in use.');

    const existingUser = await this.prisma.user.findUnique({ where: { email: adminEmail } });
    if (existingUser) throw new ConflictException('Admin email already in use.');

    // 2. Hash password
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // 3. Create Company and Admin User in a transaction
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: companyName, domain },
      });

      const user = await tx.user.create({
        data: {
          email: adminEmail,
          password: hashedPassword,
          role: 'SUPERADMIN',
          companyId: company.id,
        },
      });

      const employee = await tx.employee.create({
        data: {
          firstName,
          lastName,
          phone,
          userId: user.id,
          companyId: company.id,
        },
      });

      // 4. Seed Default Departments and Designations
      const departmentsData = [
        { name: 'Engineering', roles: ['Software Engineer', 'QA Engineer', 'Engineering Manager'] },
        { name: 'Sales', roles: ['Sales Representative', 'Account Executive', 'Sales Director'] },
        { name: 'Marketing', roles: ['Marketing Specialist', 'Content Writer', 'Marketing Manager'] },
        { name: 'Human Resources', roles: ['HR Generalist', 'Recruiter', 'HR Manager'] },
        { name: 'Finance', roles: ['Financial Analyst', 'Accountant', 'Finance Director'] },
        { name: 'Operations', roles: ['Operations Coordinator', 'Operations Manager'] },
        { name: 'Product', roles: ['Product Manager', 'UX Designer'] },
        { name: 'Executive', roles: ['CEO', 'CTO', 'COO'] }
      ];

      for (const dept of departmentsData) {
        const createdDept = await tx.department.create({
          data: { name: dept.name, companyId: company.id }
        });
        
        await tx.designation.createMany({
          data: dept.roles.map(role => ({
            name: role,
            departmentId: createdDept.id,
            companyId: company.id
          }))
        });
      }

      // 5. Seed Default Role Permissions
      const rolePermissions: Record<string, string[]> = {
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

      const permissionData: any[] = [];
      for (const [role, modules] of Object.entries(rolePermissions)) {
        for (const module of modules) {
          permissionData.push({
            role,
            module,
            action: 'VIEW',
            companyId: company.id
          });
        }
      }
      
      await tx.rolePermission.createMany({
        data: permissionData
      });

      // 6. Generate JWT
      const payload = { sub: user.id, email: user.email, role: user.role, companyId: user.companyId };
      const access_token = await this.jwtService.signAsync(payload);

      return { company, access_token };
    });
  }

  async login(email: string, pass: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isMatch = await bcrypt.compare(pass, user.password);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    const payload = { sub: user.id, email: user.email, role: user.role, companyId: user.companyId };
    return {
      access_token: await this.jwtService.signAsync(payload),
    };
  }
}
