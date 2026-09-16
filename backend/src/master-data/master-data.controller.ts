import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, ParseIntPipe, Query, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('master-data')
@UseGuards(AuthGuard)
export class MasterDataController {
  constructor(private prisma: PrismaService) {}

  @Get('departments')
  async getDepartments(@Request() req, @Query('activeOnly') activeOnly: string) {
    const where: any = { companyId: req.user.companyId };
    if (activeOnly === 'true') where.isActive = true;
    
    return this.prisma.department.findMany({
      where,
      orderBy: { name: 'asc' }
    });
  }

  @Get('designations')
  async getDesignations(@Request() req, @Query('activeOnly') activeOnly: string) {
    const where: any = { companyId: req.user.companyId };
    if (activeOnly === 'true') where.isActive = true;

    return this.prisma.designation.findMany({
      where,
      include: { department: true },
      orderBy: { name: 'asc' }
    });
  }

  // --- Department CRUD ---
  @Post('departments')
  async createDepartment(@Request() req, @Body() data: { name: string, defaultRole?: string, canCreateTasks?: boolean }) {
    const existing = await this.prisma.department.findFirst({
      where: {
        name: { equals: data.name, mode: 'insensitive' },
        companyId: req.user.companyId
      }
    });

    if (existing) {
      throw new BadRequestException('Department already exists');
    }

    return this.prisma.department.create({
      data: {
        name: data.name,
        companyId: req.user.companyId,
        defaultRole: data.defaultRole || 'EMPLOYEE',
        canCreateTasks: data.canCreateTasks === true
      }
    });
  }

  @Put('departments/:id')
  async updateDepartment(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: { name?: string, isActive?: boolean, defaultRole?: string, canCreateTasks?: boolean }) {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.defaultRole !== undefined) updateData.defaultRole = data.defaultRole;
    // Who may raise tasks, set here rather than inferred from the department's
    // name — see tasks/task-permissions.ts.
    if (data.canCreateTasks !== undefined) updateData.canCreateTasks = data.canCreateTasks;

    const result = await this.prisma.department.update({
      where: { id, companyId: req.user.companyId },
      data: updateData
    });

    // Cascade activation/deactivation to child designations
    if (data.isActive !== undefined) {
      await this.prisma.designation.updateMany({
        where: { departmentId: id, companyId: req.user.companyId },
        data: { isActive: data.isActive }
      });
    }

    return result;
  }

  @Get('departments/:id/role-mismatches')
  async getDepartmentRoleMismatches(@Request() req, @Param('id', ParseIntPipe) id: number, @Query('role') role: string) {
    if (!role) throw new BadRequestException('role query param is required');

    const employees = await this.prisma.employee.findMany({
      where: { departmentId: id, companyId: req.user.companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        user: { select: { id: true, email: true, role: true } }
      }
    });

    return employees
      .filter(e => e.user.role !== role)
      .map(e => ({ employeeId: e.id, firstName: e.firstName, lastName: e.lastName, email: e.user.email, currentRole: e.user.role }));
  }

  @Post('departments/:id/sync-roles')
  async syncDepartmentRoles(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: { role: string, employeeIds: number[] }) {
    if (!data.role || !Array.isArray(data.employeeIds) || data.employeeIds.length === 0) {
      throw new BadRequestException('role and a non-empty employeeIds array are required');
    }

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: data.employeeIds }, departmentId: id, companyId: req.user.companyId },
      select: { userId: true }
    });

    if (employees.length === 0) {
      return { updatedCount: 0 };
    }

    const result = await this.prisma.user.updateMany({
      where: { id: { in: employees.map(e => e.userId) } },
      data: { role: data.role }
    });

    return { updatedCount: result.count };
  }

  @Delete('departments/:id')
  async deleteDepartment(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.prisma.department.delete({
      where: { id, companyId: req.user.companyId }
    });
  }

  // --- Designation CRUD ---
  @Post('designations')
  async createDesignation(@Request() req, @Body() data: { name: string, departmentId: number, canEditProfiles?: boolean }) {
    return this.prisma.designation.create({
      data: {
        name: data.name,
        departmentId: data.departmentId ? Number(data.departmentId) : null,
        companyId: req.user.companyId,
        canEditProfiles: data.canEditProfiles || false
      }
    });
  }

  @Put('designations/:id')
  async updateDesignation(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: { name?: string, departmentId?: number, isActive?: boolean, canEditProfiles?: boolean }) {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.departmentId !== undefined) updateData.departmentId = data.departmentId ? Number(data.departmentId) : null;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.canEditProfiles !== undefined) updateData.canEditProfiles = data.canEditProfiles;

    return this.prisma.designation.update({
      where: { id, companyId: req.user.companyId },
      data: updateData
    });
  }

  @Delete('designations/:id')
  async deleteDesignation(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.prisma.designation.delete({
      where: { id, companyId: req.user.companyId }
    });
  }

  // --- Branch CRUD ---
  @Get('branches')
  async getBranches(@Request() req) {
    return this.prisma.branch.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { name: 'asc' }
    });
  }

  @Post('branches')
  async createBranch(@Request() req, @Body() data: any) {
    return this.prisma.branch.create({
      data: {
        name: data.name,
        address: data.address,
        startTime: data.startTime,
        endTime: data.endTime,
        latitude: data.latitude,
        longitude: data.longitude,
        weeklyOffs: data.weeklyOffs,
        isActive: data.isActive !== undefined ? data.isActive : true,
        companyId: req.user.companyId,
      }
    });
  }

  @Put('branches/:id')
  async updateBranch(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.prisma.branch.update({
      where: { id, companyId: req.user.companyId },
      data: {
        name: data.name,
        address: data.address,
        startTime: data.startTime,
        endTime: data.endTime,
        latitude: data.latitude,
        longitude: data.longitude,
        weeklyOffs: data.weeklyOffs,
        isActive: data.isActive,
      }
    });
  }

  @Delete('branches/:id')
  async deleteBranch(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.prisma.branch.delete({
      where: { id, companyId: req.user.companyId }
    });
  }

  // --- Leave Type CRUD ---
  @Get('leave-types')
  async getLeaveTypes(@Request() req) {
    return this.prisma.leaveType.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { name: 'asc' }
    });
  }

  @Post('leave-types')
  async createLeaveType(@Request() req, @Body() data: any) {
    return this.prisma.leaveType.create({
      data: {
        name: data.name,
        description: data.description,
        defaultDays: data.defaultDays,
        isPaid: data.isPaid,
        allowHalfDay: data.allowHalfDay !== undefined ? data.allowHalfDay : true,
        encashable: data.encashable,
        encashmentLimit: data.encashmentLimit,
        companyId: req.user.companyId,
      }
    });
  }

  @Put('leave-types/:id')
  async updateLeaveType(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.prisma.leaveType.update({
      where: { id, companyId: req.user.companyId },
      data: {
        name: data.name,
        description: data.description,
        defaultDays: data.defaultDays,
        isPaid: data.isPaid,
        allowHalfDay: data.allowHalfDay,
        encashable: data.encashable,
        encashmentLimit: data.encashmentLimit,
      }
    });
  }

  @Delete('leave-types/:id')
  async deleteLeaveType(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.prisma.leaveType.delete({
      where: { id, companyId: req.user.companyId }
    });
  }

  // --- Task Type CRUD ---
  // The business meaning of a task (Call, Site Visit, Documentation), kept as
  // master data so the vocabulary can change without a deploy. Distinct from
  // Issue.type, which is EPIC/STORY/TASK/BUG and drives board behaviour.
  @Get('task-types')
  async getTaskTypes(@Request() req, @Query('activeOnly') activeOnly?: string) {
    return this.prisma.taskType.findMany({
      where: {
        companyId: req.user.companyId,
        ...(activeOnly === 'true' ? { isActive: true } : {}),
      },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
  }

  @Post('task-types')
  async createTaskType(@Request() req, @Body() data: { name: string; position?: number }) {
    if (!data?.name?.trim()) throw new BadRequestException('A task type needs a name');
    const existing = await this.prisma.taskType.findFirst({
      where: { name: { equals: data.name.trim(), mode: 'insensitive' }, companyId: req.user.companyId },
    });
    if (existing) throw new BadRequestException('That task type already exists');

    return this.prisma.taskType.create({
      data: {
        name: data.name.trim(),
        position: Number(data.position) || 0,
        companyId: req.user.companyId,
      },
    });
  }

  @Put('task-types/:id')
  async updateTaskType(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { name?: string; isActive?: boolean; position?: number },
  ) {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.position !== undefined) updateData.position = Number(data.position) || 0;

    return this.prisma.taskType.update({
      where: { id, companyId: req.user.companyId },
      data: updateData,
    });
  }

  @Delete('task-types/:id')
  async deleteTaskType(@Request() req, @Param('id', ParseIntPipe) id: number) {
    // A type that tasks already carry is the truth about those tasks. Hide it
    // from new ones rather than rewriting history by deleting it.
    const inUse = await this.prisma.issue.count({
      where: { taskTypeId: id, companyId: req.user.companyId },
    });
    if (inUse > 0) {
      return this.prisma.taskType.update({
        where: { id, companyId: req.user.companyId },
        data: { isActive: false },
      });
    }
    return this.prisma.taskType.delete({ where: { id, companyId: req.user.companyId } });
  }

  // --- Holiday CRUD ---
  @Get('holidays')
  async getHolidays(@Request() req) {
    return this.prisma.holiday.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { date: 'asc' }
    });
  }

  @Post('holidays')
  async createHoliday(@Request() req, @Body() data: any) {
    if (!data.name || data.name.trim().length === 0) {
      throw new BadRequestException('Holiday name is required');
    }
    if (data.name.length > 100) {
      throw new BadRequestException('Holiday name cannot exceed 100 characters');
    }
    if (!data.date || isNaN(Date.parse(data.date))) {
      throw new BadRequestException('Holiday date is required and must be valid');
    }
    return this.prisma.holiday.create({
      data: {
        name: data.name,
        date: new Date(data.date),
        companyId: req.user.companyId,
      }
    });
  }

  @Post('holidays/seed')
  async seedHolidays(@Request() req, @Body() data: { holidays: { name: string, date: string }[] }) {
    if (!data.holidays || data.holidays.length === 0) return { success: false };
    const createPromises = data.holidays.map(h => this.prisma.holiday.create({
      data: {
        name: h.name,
        date: new Date(h.date),
        companyId: req.user.companyId
      }
    }));
    await Promise.all(createPromises);
    return { success: true, count: data.holidays.length };
  }

  @Put('holidays/:id')
  async updateHoliday(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: { name?: string, date?: string }) {
    const updateData: any = {};
    if (data.name !== undefined) {
      if (data.name.trim().length === 0) throw new BadRequestException('Holiday name cannot be empty');
      if (data.name.length > 100) throw new BadRequestException('Holiday name cannot exceed 100 characters');
      updateData.name = data.name;
    }
    if (data.date !== undefined) {
      if (isNaN(Date.parse(data.date))) throw new BadRequestException('Invalid date provided');
      updateData.date = new Date(data.date);
    }

    return this.prisma.holiday.update({
      where: { id, companyId: req.user.companyId },
      data: updateData
    });
  }

  @Delete('holidays/:id')
  async deleteHoliday(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.prisma.holiday.delete({
      where: { id, companyId: req.user.companyId }
    });
  }

  // --- Blackout Date CRUD ---
  @Get('blackout-dates')
  async getBlackoutDates(@Request() req) {
    return this.prisma.blackoutDate.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { date: 'asc' }
    });
  }

  @Post('blackout-dates')
  async createBlackoutDate(@Request() req, @Body() data: { date: string, reason: string, departmentId?: number }) {
    return this.prisma.blackoutDate.create({
      data: {
        date: new Date(data.date),
        reason: data.reason,
        departmentId: data.departmentId ? Number(data.departmentId) : null,
        companyId: req.user.companyId,
      }
    });
  }

  @Put('blackout-dates/:id')
  async updateBlackoutDate(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: { date?: string, reason?: string, departmentId?: number }) {
    const updateData: any = {};
    if (data.date !== undefined) updateData.date = new Date(data.date);
    if (data.reason !== undefined) updateData.reason = data.reason;
    if (data.departmentId !== undefined) updateData.departmentId = data.departmentId ? Number(data.departmentId) : null;

    return this.prisma.blackoutDate.update({
      where: { id, companyId: req.user.companyId },
      data: updateData
    });
  }

  @Delete('blackout-dates/:id')
  async deleteBlackoutDate(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.prisma.blackoutDate.delete({
      where: { id, companyId: req.user.companyId }
    });
  }

  // --- Shift Rotation CRUD ---
  @Get('shift-rotations')
  async getShiftRotations(@Request() req) {
    return this.prisma.shiftRotation.findMany({
      where: { companyId: req.user.companyId },
      include: { employees: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' }
    });
  }

  @Post('shift-rotations')
  async createShiftRotation(@Request() req, @Body() data: any) {
    return this.prisma.shiftRotation.create({
      data: {
        name: data.name,
        description: data.description,
        rotationType: data.rotationType,
        shiftIds: data.shiftIds, // Should be a JSON string like "[1,2]"
        companyId: req.user.companyId,
        employees: data.employeeIds ? {
          connect: data.employeeIds.map((id: number) => ({ id }))
        } : undefined
      },
      include: { employees: true }
    });
  }

  @Put('shift-rotations/:id')
  async updateShiftRotation(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.prisma.shiftRotation.update({
      where: { id, companyId: req.user.companyId },
      data: {
        name: data.name,
        description: data.description,
        rotationType: data.rotationType,
        shiftIds: data.shiftIds,
        employees: data.employeeIds ? {
          set: data.employeeIds.map((id: number) => ({ id }))
        } : undefined
      },
      include: { employees: true }
    });
  }

  @Delete('shift-rotations/:id')
  async deleteShiftRotation(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.prisma.shiftRotation.delete({
      where: { id, companyId: req.user.companyId }
    });
  }
}
