import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, ParseIntPipe, ForbiddenException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { ShiftRosterService } from './shift-roster.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { isSuperAdmin } from '../common/company-roles';

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

  /** Copy last month's roster into a month, weekday for weekday (21 Oct 2026). */
  @Post('roster/copy-previous-month')
  @Permissions('attendance/shifts')
  copyPreviousMonth(@Request() req, @Body() data: any) {
    return this.rosterService.copyPreviousMonth(req.user.companyId, data);
  }

  /**
   * Change the standing shift of many people at once (11 Nov 2026). Super Admin
   * only: this is permanent, unlike the roster, which is per day.
   */
  @Post('roster/permanent')
  @Permissions('attendance/shifts')
  setPermanentShift(@Request() req, @Body() data: { employeeIds: number[]; shiftId: number; clearFutureRoster?: boolean }) {
    if (!isSuperAdmin(req.user.role)) throw new ForbiddenException('Only a Super Admin can change shifts permanently');
    return this.rosterService.setPermanentShift(req.user.companyId, data);
  }

  @Post('roster/clear')
  @Permissions('attendance/shifts')
  clearRoster(@Request() req, @Body() data: any) {
    return this.rosterService.clearRange(req.user.companyId, data);
  }

  // On-site "No Project" requests — visible to anyone with roster access.
  @Get('roster/onsite/pending')
  @Permissions('attendance/shifts')
  pendingOnsite(@Request() req) {
    return this.rosterService.getPendingOnsiteApprovals(req.user.companyId);
  }

  // Approve / reject — only Administrators and HR (enforced in the service).
  @Post('roster/onsite/:entryId/resolve')
  @Permissions('attendance/shifts')
  resolveOnsite(
    @Request() req,
    @Param('entryId', ParseIntPipe) entryId: number,
    @Body() body: { action: 'APPROVED' | 'REJECTED' },
  ) {
    return this.rosterService.resolveOnsiteApproval(
      req.user.companyId,
      entryId,
      body.action,
      req.user.sub,
      req.user.role,
    );
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
