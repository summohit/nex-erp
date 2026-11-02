import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Giving awards and managing award types is for HR and administrators, as on
 * the web. These routes used to be open to any signed-in user, and the edit
 * and delete routes did not even check the company.
 */
const AWARD_MANAGERS = ['SUPERADMIN', 'ADMIN', 'HR'];
function requireAwardManager(req: any) {
  if (!AWARD_MANAGERS.includes(req.user?.role)) {
    throw new ForbiddenException('Only HR and administrators can manage awards.');
  }
}

@Controller('appreciation')
@UseGuards(AuthGuard)
export class AppreciationController {
  constructor(private prisma: PrismaService) {}

  // Get all awarded appreciations
  @Get()
  async getAppreciations(@Request() req) {
    const companyId = req.user.companyId;
    return this.prisma.appreciation.findMany({
      where: { companyId },
      include: {
        awardType: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            designation: { select: { name: true } },
            department: { select: { name: true } }
          }
        }
      },
      orderBy: { givenDate: 'desc' }
    });
  }

  // Get award types
  @Get('award-types')
  async getAwardTypes(@Request() req) {
    const companyId = req.user.companyId;
    let types = await this.prisma.awardType.findMany({
      where: { companyId },
      orderBy: { id: 'asc' }
    });

    // Seed default award types if empty
    if (types.length === 0) {
      const defaultTypes = [
        { title: 'Top Performer', icon: 'trophy', color: 'blue' },
        { title: 'Leadership Award', icon: 'ribbon', color: 'green' },
        { title: 'Innovation Award', icon: 'star', color: 'purple' },
        { title: 'Employee of the Year', icon: 'trophy', color: 'orange' },
        { title: 'Employee of the Month', icon: 'award', color: 'red' },
        { title: 'Customer Hero', icon: 'gift', color: 'yellow' },
        { title: 'Best Team Player', icon: 'thumbsup', color: 'green' },
        { title: 'Best Attendance of the Year', icon: 'trophy', color: 'orange' },
        { title: 'Behind the Scenes', icon: 'star', color: 'purple' }
      ];

      for (const dt of defaultTypes) {
        await this.prisma.awardType.create({
          data: {
            ...dt,
            companyId
          }
        });
      }

      types = await this.prisma.awardType.findMany({
        where: { companyId },
        orderBy: { id: 'asc' }
      });
    }

    return types;
  }

  // Create Award Type (Admin / HR)
  @Post('award-types')
  async createAwardType(@Request() req, @Body() data: any) {
    requireAwardManager(req);
    return this.prisma.awardType.create({
      data: {
        title: data.title,
        icon: data.icon || 'trophy',
        color: data.color || 'orange',
        status: data.status !== undefined ? data.status : true,
        companyId: req.user.companyId
      }
    });
  }

  // Update Award Type (Admin / HR)
  @Put('award-types/:id')
  async updateAwardType(@Request() req, @Param('id') id: string, @Body() data: any) {
    requireAwardManager(req);
    await this.ownAwardType(req, id);
    return this.prisma.awardType.update({
      where: { id: Number(id) },
      data: {
        title: data.title,
        icon: data.icon,
        color: data.color,
        status: data.status
      }
    });
  }

  // Delete Award Type
  @Delete('award-types/:id')
  async deleteAwardType(@Request() req, @Param('id') id: string) {
    requireAwardManager(req);
    await this.ownAwardType(req, id);
    return this.prisma.awardType.delete({
      where: { id: Number(id) }
    });
  }

  // Create Appreciation (Grant Award)
  @Post()
  async createAppreciation(@Request() req, @Body() data: any) {
    requireAwardManager(req);
    // The award type and the person must both be in the caller's company.
    const [type, emp] = await Promise.all([
      this.prisma.awardType.findFirst({ where: { id: Number(data.awardTypeId), companyId: req.user.companyId }, select: { id: true } }),
      this.prisma.employee.findFirst({ where: { id: Number(data.employeeId), companyId: req.user.companyId }, select: { id: true } }),
    ]);
    if (!type || !emp) throw new NotFoundException('Award type or employee not found');
    return this.prisma.appreciation.create({
      data: {
        awardTypeId: Number(data.awardTypeId),
        employeeId: Number(data.employeeId),
        givenDate: new Date(data.givenDate),
        summary: data.summary,
        photoUrl: data.photoUrl || null,
        companyId: req.user.companyId
      },
      include: {
        awardType: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            designation: { select: { name: true } },
            department: { select: { name: true } }
          }
        }
      }
    });
  }

  // Delete Appreciation
  @Delete(':id')
  async deleteAppreciation(@Request() req, @Param('id') id: string) {
    requireAwardManager(req);
    const found = await this.prisma.appreciation.findFirst({ where: { id: Number(id), companyId: req.user.companyId }, select: { id: true } });
    if (!found) throw new NotFoundException('Appreciation not found');
    return this.prisma.appreciation.delete({
      where: { id: Number(id) }
    });
  }

  private async ownAwardType(req: any, id: string) {
    const t = await this.prisma.awardType.findFirst({ where: { id: Number(id), companyId: req.user.companyId }, select: { id: true } });
    if (!t) throw new NotFoundException('Award type not found');
  }
}
