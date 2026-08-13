import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@Request() req) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { 
        company: true, 
        employee: {
          include: {
            _count: { select: { subordinates: true } }
          }
        },
        userRoles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true
                  }
                }
              }
            }
          }
        }
      }
    });
    if (user) {
      delete (user as any).password;
      (user as any).employeeId = (user as any).employee?.id ?? null;
      (user as any).isManager = ((user as any).employee?._count?.subordinates ?? 0) > 0;
    }
    return user;
  }

  @UseGuards(AuthGuard)
  @Post('onboarding')
  async completeOnboarding(@Request() req, @Body() data: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { employee: true }
    });

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    // 1. Update Company
    await this.prisma.company.update({
      where: { id: user.companyId },
      data: {
        logoUrl: data.logoUrl,
        industry: data.industry,
        size: data.size,
        timezone: data.timezone,
        onboardingCompleted: true
      }
    });

    // 2. Update Employee Profile/Preferences
    if (user.employee) {
      await this.prisma.employee.update({
        where: { id: user.employee.id },
        data: {
          designationId: data.designationId ? parseInt(data.designationId) : null,
          departmentId: data.departmentId ? parseInt(data.departmentId) : null,
          avatarUrl: data.avatarUrl,
          themePref: data.themePref,
          currency: data.currency
        }
      });
    }

    return { success: true };
  }
}
