import { Controller, Get, Post, Body, Query, Param, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TimesheetsService } from './timesheets.service';
import type { TimesheetScope, TimesheetFilters, TimesheetStatus } from './timesheets.service';

@UseGuards(AuthGuard)
@Controller('timesheets')
export class TimesheetsController {
  constructor(private readonly timesheets: TimesheetsService) {}

  /** The caller's own week (§21, "My Timesheet"). */
  @Get('me')
  myWeek(@Req() req, @Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.timesheets.getWeek(req.user.companyId, req.user.employeeId, startDate, endDate);
  }

  /** Days waiting on this reviewer. */
  @Get('pending')
  pending(@Req() req) {
    return this.timesheets.getPendingReviews(
      req.user.companyId, req.user.employeeId ?? null, req.user.role,
    );
  }

  /**
   * The team / all-employees / finance views (§21).
   *
   * One route for all three because they are one screen with a scope switch —
   * the difference between them is who is listed and whether cost is included,
   * which is the service's decision to make, not three controllers'.
   */
  @Get('overview')
  overview(
    @Req() req,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('scope') scope: TimesheetScope = 'TEAM',
    @Query() q: Record<string, string> = {},
  ) {
    const num = (v?: string) => (v && !isNaN(Number(v)) ? Number(v) : undefined);
    const filters: TimesheetFilters = {
      employeeId: num(q.employeeId),
      projectId: num(q.projectId),
      clientId: num(q.clientId),
      departmentId: num(q.departmentId),
      pmId: num(q.pmId),
      source: q.source === 'MANUAL' || q.source === 'TIMER' ? q.source : undefined,
      status: (q.status as TimesheetStatus) || undefined,
      task: q.task?.trim() || undefined,
      billable:
        q.billable === 'BILLABLE' || q.billable === 'NON_BILLABLE' ? q.billable : undefined,
    };
    return this.timesheets.getOverview(
      req.user.companyId, req.user.employeeId ?? null, req.user.role,
      scope, startDate, endDate, filters,
    );
  }

  /**
   * Someone else's week. Declared after the fixed segments above so "me" and
   * "pending" are never read as an employee id.
   */
  @Get('employee/:employeeId')
  employeeWeek(
    @Req() req,
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.timesheets.getWeek(req.user.companyId, employeeId, startDate, endDate);
  }

  @Post('submit')
  submit(@Req() req, @Body('date') date: string) {
    return this.timesheets.submitDay(req.user.companyId, req.user.employeeId, date);
  }

  @Post('review')
  review(
    @Req() req,
    @Body() body: { employeeId: number; date: string; decision: 'APPROVED' | 'REJECTED'; reason?: string },
  ) {
    return this.timesheets.reviewDay(
      req.user.companyId,
      req.user.employeeId ?? null,
      req.user.role,
      Number(body?.employeeId),
      body?.date,
      body?.decision,
      body?.reason,
    );
  }
}
