import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { ShiftRosterService } from './shift-roster.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('shifts')
@UseGuards(AuthGuard, PermissionsGuard)
export class ShiftsController {
  constructor(
    private readonly shiftsService: ShiftsService,
    private readonly rosterService: ShiftRosterService,
  ) {}

  @Get()
  findAll(@Request() req) {
    return this.shiftsService.findAll(req.user.companyId);
  }

  // ── roster ────────────────────────────────────────────────────────────
  // Declared before ':id' routes so "roster" isn't parsed as an id.
  @Get('roster')
  @Permissions('attendance/shifts')
  getRoster(@Request() req, @Query() q: any) {
    return this.rosterService.getGrid(req.user.companyId, {
      start: q.start,
      end: q.end,
      departmentId: q.departmentId ? parseInt(q.departmentId, 10) : undefined,
      employeeId: q.employeeId ? parseInt(q.employeeId, 10) : undefined,
    });
  }

  @Post('roster')
  @Permissions('attendance/shifts')
  assignRoster(@Request() req, @Body() data: any) {
    return this.rosterService.assign(req.user.companyId, data);
  }

  @Post('roster/bulk')
  @Permissions('attendance/shifts')
  bulkAssignRoster(@Request() req, @Body() data: any) {
    return this.rosterService.bulkAssign(req.user.companyId, data);
  }

  @Post('roster/clear')
  @Permissions('attendance/shifts')
  clearRoster(@Request() req, @Body() data: any) {
    return this.rosterService.clearRange(req.user.companyId, data);
  }

  @Get('me')
  getMyShift(@Request() req) {
    return this.shiftsService.getMyShift(req.user.sub);
  }

  @Get(':id/employees')
  getShiftEmployees(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.shiftsService.getShiftEmployees(req.user.companyId, id);
  }

  @Post()
  @Permissions('attendance/shifts')
  create(@Request() req, @Body() data: any) {
    return this.shiftsService.create(req.user.companyId, data);
  }

  @Put(':id')
  @Permissions('attendance/shifts')
  update(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.shiftsService.update(req.user.companyId, id, data);
  }

  @Delete(':id')
  @Permissions('attendance/shifts')
  delete(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.shiftsService.delete(req.user.companyId, id);
  }
}
