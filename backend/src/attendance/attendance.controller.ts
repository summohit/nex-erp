import { Controller, Get, Post, Body, UseGuards, Request, Param, Query, ParseIntPipe } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('attendance')
@UseGuards(AuthGuard, PermissionsGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('me')
  getTodayAttendance(@Request() req) {
    return this.attendanceService.getTodayAttendance(req.user.sub);
  }

  // `from`/`to` are ISO dates. Callers that render one month should pass that
  // month; omitting them falls back to a bounded recent window rather than the
  // employee's entire history.
  @Get('history/me')
  getMyHistory(@Request() req, @Query('from') from?: string, @Query('to') to?: string) {
    return this.attendanceService.getMyHistory(req.user.sub, from, to);
  }

  @Get('employee/:employeeId')
  getEmployeeHistory(
    @Param('employeeId') employeeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.attendanceService.getEmployeeHistory(+employeeId, from, to);
  }

  @Post('clock-in')
  clockIn(@Request() req, @Body() data: { lat?: number, lng?: number, outsideReason?: string, outsideProofUrl?: string }) {
    const ipAddress = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip;
    return this.attendanceService.clockIn(req.user.sub, { ...data, ipAddress });
  }

  @Post('clock-out')
  clockOut(@Request() req, @Body() data: {
    lat?: number, lng?: number, reason?: string, proofUrl?: string,
    outsideReason?: string, outsideProofUrl?: string,
  }) {
    return this.attendanceService.clockOut(req.user.sub, data);
  }

  // §Att5: the late clock-out queue. Guarded in the service rather than with a
  // roles decorator, because who may approve is partly a database question —
  // the delegates a Super Admin has named — and not only a role.
  // B3: clock-ins / clock-outs made outside the office radius.
  @Get('geofence/pending')
  getPendingGeofence(@Request() req) {
    return this.attendanceService.getPendingGeofence(req.user.companyId, req.user.role);
  }

  @Get('geofence/can-approve')
  canApproveGeofence(@Request() req) {
    return { canApprove: this.attendanceService.mayApproveGeofence(req.user.role) };
  }

  @Post('geofence/:id/review')
  reviewGeofence(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { action: 'APPROVE' | 'REJECT'; note?: string },
  ) {
    return this.attendanceService.reviewGeofence(
      req.user.companyId, id, data, req.user.role, req.user.employeeId ?? null,
    );
  }

  @Get('clock-out/pending')
  getPendingClockOuts(@Request() req) {
    return this.attendanceService.getPendingClockOuts(
      req.user.companyId, req.user.role, req.user.employeeId ?? null,
    );
  }

  /** Whether to show the queue at all, so the client need not guess. */
  @Get('clock-out/can-approve')
  async canApproveClockOut(@Request() req) {
    return {
      canApprove: await this.attendanceService.mayApproveClockOut(
        req.user.companyId, req.user.role, req.user.employeeId ?? null,
      ),
    };
  }

  @Get('clock-out/mine')
  getMyClockOutApprovals(@Request() req) {
    return this.attendanceService.getMyClockOutApprovals(req.user.sub);
  }

  @Post('clock-out/:id/review')
  reviewClockOut(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { action: 'APPROVE' | 'REJECT'; note?: string },
  ) {
    return this.attendanceService.reviewClockOut(
      req.user.companyId, id, data, req.user.role, req.user.employeeId ?? null,
    );
  }

  @Get('regularization/me')
  getMyRegularizations(@Request() req) {
    return this.attendanceService.getMyRegularizations(req.user.sub);
  }

  @Get('regularization/pending')
  getPendingRegularizations(@Request() req) {
    return this.attendanceService.getPendingRegularizations(req.user.companyId);
  }

  @Post('regularization')
  requestRegularization(@Request() req, @Body() data: { date: string, proposedClockIn?: string, proposedClockOut?: string, reason: string }) {
    return this.attendanceService.requestRegularization(req.user.sub, data);
  }

  @Post('regularization/:id/resolve')
  resolveRegularization(@Request() req, @Param('id') id: string, @Body() data: { status: string, rejectionReason?: string }) {
    return this.attendanceService.resolveRegularization(+id, req.user.sub, data.status, data.rejectionReason);
  }

  @Get('team/timeline')
  getTeamTimeline(@Request() req, @Query('start') start: string, @Query('end') end: string) {
    return this.attendanceService.getTeamTimeline(req.user.companyId, start, end);
  }

  /** §Att7: attendance grouped by shift, for a week or a month. */
  @Get('shift-summary')
  @Permissions('attendance/all')
  getShiftPeriodSummary(
    @Request() req,
    @Query('period') period?: string,
    @Query('date') date?: string,
  ) {
    return this.attendanceService.getShiftPeriodSummary(
      req.user.companyId, period === 'week' ? 'week' : 'month', date,
    );
  }

  @Get('all')
  @Permissions('attendance/all')
  getAllEmployeesAttendance(
    @Request() req,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('employeeId') employeeId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
  ) {
    return this.attendanceService.getAllEmployeesAttendance(req.user.companyId, {
      month: month ? +month : undefined,
      year: year ? +year : undefined,
      employeeId: employeeId ? +employeeId : undefined,
      departmentId: departmentId ? +departmentId : undefined,
      status,
    });
  }
}
