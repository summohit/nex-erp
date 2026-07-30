import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async inviteEmployee(
    adminCompanyId: number,
    email: string,
    firstName: string,
    lastName: string,
    role: string
  ) {
    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) throw new ConflictException('User email already exists.');

    // 1. Generate temp password
    const tempPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // 2. Create User and Employee in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          role,
          companyId: adminCompanyId,
        },
      });

      const employee = await tx.employee.create({
        data: {
          firstName,
          lastName,
          userId: user.id,
          companyId: adminCompanyId,
        },
      });

      return { user, employee };
    });

    // 3. Auto-email temp password (Mocked for now via console)
    console.log(`[Email Service] Sent to ${email}: Your temp password is ${tempPassword}`);
    
    // In production:
    // await this.mailService.sendMail({ to: email, subject: 'Welcome to Nex-ERP', text: \`Password: \${tempPassword}\` });

    return result;
  }
}
