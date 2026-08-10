import { Controller, Get, Post, Body, UseGuards, Request, Param, Query } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('attendance')
@UseGuards(AuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('me')
  getTodayAttendance(@Request() req) {
    return this.attendanceService.getTodayAttendance(req.user.sub);
  }

  @Get('history/me')
  getMyHistory(@Request() req) {
    return this.attendanceService.getMyHistory(req.user.sub);
  }

  @Get('employee/:employeeId')
  getEmployeeHistory(@Param('employeeId') employeeId: string) {
    return this.attendanceService.getEmployeeHistory(+employeeId);
  }

  @Post('clock-in')
  clockIn(@Request() req, @Body() data: { lat?: number, lng?: number }) {
    const ipAddress = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip;
    return this.attendanceService.clockIn(req.user.sub, { ...data, ipAddress });
  }

  @Post('clock-out')
  clockOut(@Request() req, @Body() data: { lat?: number, lng?: number }) {
    return this.attendanceService.clockOut(req.user.sub, data);
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
}
