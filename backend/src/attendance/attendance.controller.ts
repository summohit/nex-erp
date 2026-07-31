import { Controller, Get, Post, Body, UseGuards, Request, Param } from '@nestjs/common';
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
    return this.attendanceService.clockIn(req.user.sub, data);
  }

  @Post('clock-out')
  clockOut(@Request() req, @Body() data: { lat?: number, lng?: number }) {
    return this.attendanceService.clockOut(req.user.sub, data);
  }
}
