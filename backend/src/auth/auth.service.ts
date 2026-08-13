import { Injectable, UnauthorizedException, ConflictException, BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service';
import { CompanySeederService } from '../company-seeder/company-seeder.service';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
    private companySeederService: CompanySeederService
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
          'settings', 'settings/company', 'settings/master-data', 'settings/permissions', 'settings/integrations',
          'projects'
        ],
        'HR': [
          'employees', 'employees/directory', 'employees/org-chart', 'employees/onboarding', 'employees/documents',
          'recruitment', 'recruitment/jobs', 'recruitment/candidates', 'recruitment/interviews',
          'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/shifts', 'attendance/holidays',
          'payroll', 'payroll/processing', 'payroll/payslips',
          'projects'
        ],
        'FINANCE': [
          'employees', 'employees/directory', 'employees/org-chart',
          'attendance', 'attendance/timesheets',
          'payroll', 'payroll/processing', 'payroll/payslips', 'payroll/expenses', 'payroll/taxes',
          'assets', 'assets/inventory', 'assets/assignments',
          'projects'
        ],
        'SALES': [
          'employees', 'employees/org-chart',
          'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/holidays',
          'payroll', 'payroll/payslips', 'payroll/expenses',
          'projects'
        ],
        'EMPLOYEE': [
          'employees', 'employees/org-chart',
          'recruitment', 'recruitment/interviews',
          'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/holidays',
          'payroll', 'payroll/payslips', 'payroll/expenses', 'payroll/taxes',
          'assets', 'assets/requests',
          'projects'
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

      // 6. Generate Verification Token
      const token = crypto.randomBytes(32).toString('hex');
      await tx.verificationToken.create({
        data: {
          identifier: adminEmail,
          token,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        }
      });

      // 7. Send Verification Email
      this.mailService.sendVerificationEmail(adminEmail, token).catch(e => console.error(e));

      // 8. Seed default master data asynchronously
      this.companySeederService.seedCompanyDefaults(company.id).catch(e => console.error(e));

      // We do not return JWTs here because the user must verify their email first.
      return { message: 'Signup successful. Please check your email to verify your account.' };
    });
  }

  async login(email: string, pass: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' }
      }
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isMatch = await bcrypt.compare(pass, user.password);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    if (user.status === 'PENDING_VERIFICATION') {
      throw new UnauthorizedException('Please verify your email address before logging in.');
    }
    
    if (user.status === 'SUSPENDED' || user.status === 'INACTIVE' || user.status === 'BLOCKED') {
      throw new UnauthorizedException('Account is blocked connect administration');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { userId: user.id },
      select: { id: true }
    });

    const payload = { sub: user.id, email: user.email, role: user.role, companyId: user.companyId, employeeId: employee?.id ?? null };
    
    const access_token = await this.jwtService.signAsync(payload, { expiresIn: '1h' });
    const refresh_token = await this.jwtService.signAsync(payload, { 
      expiresIn: '7d', 
      secret: (process.env.JWT_SECRET || 'super-secret') + '_refresh' 
    });

    return { access_token, refresh_token };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: (process.env.JWT_SECRET || 'super-secret') + '_refresh'
      });

      const newPayload = { sub: payload.sub, email: payload.email, role: payload.role, companyId: payload.companyId, employeeId: payload.employeeId ?? null };
      
      const new_access_token = await this.jwtService.signAsync(newPayload, { expiresIn: '1h' });
      const new_refresh_token = await this.jwtService.signAsync(newPayload, { 
        expiresIn: '7d', 
        secret: (process.env.JWT_SECRET || 'super-secret') + '_refresh' 
      });

      return { access_token: new_access_token, refresh_token: new_refresh_token };
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async verifyEmail(token: string) {
    const verificationToken = await this.prisma.verificationToken.findUnique({
      where: { token }
    });

    if (!verificationToken) {
      throw new UnauthorizedException('Invalid verification token.');
    }

    if (new Date() > verificationToken.expiresAt) {
      await this.prisma.verificationToken.delete({ where: { id: verificationToken.id } });
      throw new UnauthorizedException('Verification token has expired.');
    }

    const user = await this.prisma.user.findUnique({ where: { email: verificationToken.identifier } });
    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        status: 'ACTIVE'
      }
    });

    await this.prisma.verificationToken.delete({ where: { id: verificationToken.id } });

    // Send Welcome Email
    this.mailService.sendWelcomeEmail(user.email).catch(e => console.error(e));

    return { message: 'Email verified successfully.' };
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' }
      }
    });

    if (user) {
      const otp = await this.createPasswordResetToken(normalizedEmail);

      try {
        await this.mailService.sendPasswordResetOtpEmail(normalizedEmail, otp);
      } catch (error: any) {
        this.logger.error(`Password reset email failed to send for ${normalizedEmail}: ${error?.message}`);
        throw new HttpException(
          `Could not send the password reset email. ${error?.message || 'Please try again later.'}`,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
    }

    // Only reach here when the email does not exist (or was sent successfully)
    return { message: 'If an account exists for this email, a password reset code has been sent.' };
  }

  async resetPassword(email: string, otp: string, newPassword: string) {
    if (!otp) {
      throw new BadRequestException('Verification code is required.');
    }

    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters.');
    }

    const verificationToken = await this.prisma.verificationToken.findFirst({
      where: {
        identifier: email.trim().toLowerCase(),
        token: otp
      }
    });

    if (!verificationToken) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    if (new Date() > verificationToken.expiresAt) {
      await this.prisma.verificationToken.delete({ where: { id: verificationToken.id } });
      throw new BadRequestException('Verification code has expired. Please request a new one.');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() }
    });

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    // Consume the code so it cannot be reused
    await this.prisma.verificationToken.deleteMany({
      where: { identifier: email.trim().toLowerCase() }
    });

    return { message: 'Password reset successfully. Please log in with your new password.' };
  }

  private async createPasswordResetToken(identifier: string): Promise<string> {
    const maxAttempts = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const otp = crypto.randomInt(100000, 999999).toString();

      await this.prisma.verificationToken.deleteMany({
        where: { identifier }
      });

      try {
        await this.prisma.verificationToken.create({
          data: {
            identifier,
            token: otp,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
          }
        });
        return otp;
      } catch (error: any) {
        if (error?.code === 'P2002' && attempt < maxAttempts) {
          continue;
        }
        throw error;
      }
    }

    throw new Error('Could not generate a unique password reset code. Please try again.');
  }

  async sendResetCodeToUser(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    const otp = await this.createPasswordResetToken(user.email);

    try {
      await this.mailService.sendPasswordResetOtpEmail(user.email, otp);
    } catch (error: any) {
      this.logger.error(`Password reset email failed to send for ${user.email}: ${error?.message}`);
      throw new HttpException(
        `Could not send the password reset email. ${error?.message || 'Please try again later.'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return { message: 'Password reset code sent to your email. It is valid for 10 minutes.' };
  }

  async resendVerificationEmail(email: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' }
      }
    });
    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    if (user.status !== 'PENDING_VERIFICATION') {
      throw new UnauthorizedException('Email is already verified.');
    }

    // Delete any existing tokens for this user
    await this.prisma.verificationToken.deleteMany({
      where: { identifier: email }
    });

    const token = crypto.randomBytes(32).toString('hex');
    await this.prisma.verificationToken.create({
      data: {
        identifier: email,
        token: token,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      }
    });

    this.mailService.sendVerificationEmail(email, token).catch(e => console.error(e));

    return { message: 'Verification email resent successfully.' };
  }
}
