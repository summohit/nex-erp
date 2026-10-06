import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Query, ParseIntPipe } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('leaves')
@UseGuards(AuthGuard)
export class LeavesController {
  constructor(private readonly leavesService: LeavesService) {}

  @Post('assign-balance')
  assignBalance(@Request() req, @Body() data: { employeeId: number, leaveTypeId: number, allocated: number, year: number }) {
    return this.leavesService.assignLeaveBalance(data);
  }

  @Get('balances/me')
  getMyBalances(@Request() req, @Query('year') year: string) {
    const y = year ? parseInt(year) : new Date().getFullYear();
    return this.leavesService.getMyBalances(req.user.sub, y);
  }

  @Get('balances')
  getAllBalances(
    @Request() req,
    @Query('year') year?: string,
    @Query('employeeId') employeeId?: string,
    @Query('limit') limit?: string,
  ) {
    const y = year ? parseInt(year) : new Date().getFullYear();
    const empId = employeeId ? parseInt(employeeId) : undefined;
    const requestedLimit = limit ? parseInt(limit, 10) : 200;
    const safeLimit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 200;
    return this.leavesService.getAllBalances(req.user.companyId, y, empId, safeLimit);
  }

  /** Leave quota report. Non-admins are scoped to themselves by the service. */
  @Get('reports/quota')
  getQuotaReport(
    @Request() req,
    @Query('year') year?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    const emp = employeeId ? parseInt(employeeId, 10) : undefined;
    return this.leavesService.getQuotaReport(
      req.user.companyId,
      { sub: req.user.sub, role: req.user.role },
      Number.isFinite(y) ? y : new Date().getFullYear(),
      emp && Number.isFinite(emp) ? emp : undefined,
    );
  }

  @Post('request')
  requestLeave(@Request() req, @Body() data: { leaveTypeId: number, startDate: string, endDate: string, reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string }) {
    return this.leavesService.requestLeave(req.user.sub, data);
  }

  // §Att9: apply leave for somebody else. Its own route rather than an
  // optional employeeId on `request`, so an ordinary employee cannot reach the
  // on-behalf path by adding a field to a payload.
  @Post('request/on-behalf')
  requestLeaveOnBehalf(
    @Request() req,
    @Body() data: { employeeId: number, leaveTypeId: number, startDate: string, endDate: string, reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string },
  ) {
    return this.leavesService.requestLeaveOnBehalf(req.user.sub, data);
  }

  /** Whether to offer the on-behalf option at all — partly a delegate list. */
  @Get('request/can-act-on-behalf')
  async canActOnBehalf(@Request() req) {
    return {
      canActOnBehalf: await this.leavesService.mayActOnBehalf(
        req.user.companyId, req.user.role, req.user.employeeId ?? null,
      ),
    };
  }

  @Get('requests/me')
  getMyRequests(@Request() req) {
    return this.leavesService.getMyRequests(req.user.sub);
  }

  @Get('requests/managers')
  getManagerRequests(@Request() req) {
    return this.leavesService.getManagerRequests(req.user.sub);
  }

  @Get('requests')
  getRequests(@Request() req, @Query() filter: any) {
    return this.leavesService.getRequests(req.user.companyId, filter, req.user.role);
  }

  @Put('requests/:id')
  updateRequest(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: { startDate?: string, endDate?: string, reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string }) {
    return this.leavesService.updateRequest(req.user.sub, id, data);
  }

  @Put('requests/:id/cancel')
  cancelRequest(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.leavesService.cancelRequest(req.user.sub, id);
  }

  // §Att10: Super Admin only, enforced in the service. A soft delete — the row
  // survives, every reader stops seeing it, and an approved request gives its
  // days back on the way out.
  @Delete('requests/:id')
  deleteRequest(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.leavesService.deleteRequest(req.user.sub, id);
  }

  @Put('requests/:id/status')
  updateRequestStatus(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: { status: string, rejectionReason?: string }) {
    return this.leavesService.updateRequestStatus(req.user.sub, id, data.status, data.rejectionReason);
  }
}
