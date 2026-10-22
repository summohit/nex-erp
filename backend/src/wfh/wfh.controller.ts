import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { WfhService } from './wfh.service';

/** Work From Home requests (19 Oct 2026). */
@Controller('wfh')
@UseGuards(AuthGuard)
export class WfhController {
  constructor(private readonly svc: WfhService) {}

  private v(req: any) {
    return { companyId: req.user.companyId, role: req.user.role, employeeId: req.user.employeeId ?? null };
  }

  @Get('settings')
  async settings(@Request() req) { return { wfhDaysPerMonth: await this.svc.getLimit(req.user.companyId) }; }

  @Put('settings')
  setSettings(@Request() req, @Body() body: { wfhDaysPerMonth: number }) { return this.svc.setLimit(this.v(req), body?.wfhDaysPerMonth); }

  @Get('mine')
  mine(@Request() req) { return this.svc.mine(this.v(req)); }

  @Post()
  create(@Request() req, @Body() body: { date: string; reason: string }) { return this.svc.create(this.v(req), body); }

  @Post(':id/cancel')
  cancel(@Request() req, @Param('id', ParseIntPipe) id: number) { return this.svc.cancel(this.v(req), id); }

  @Post('assign')
  assign(@Request() req, @Body() body: { employeeIds: number[]; dates: string[]; reason?: string }) { return this.svc.assign(this.v(req), body); }

  /** Permanent WFH (22 Oct 2026): HR and the super admin, from the roster. */
  @Get('permanent')
  permanentList(@Request() req) { return this.svc.permanentList(this.v(req)); }

  @Post('permanent')
  setPermanent(@Request() req, @Body() body: { employeeIds: number[]; startDate?: string; weekdays?: number[]; reason?: string }) {
    return this.svc.setPermanent(this.v(req), body);
  }

  @Post('permanent/end')
  endPermanent(@Request() req, @Body() body: { employeeIds: number[]; fromDate?: string }) { return this.svc.endPermanent(this.v(req), body); }

  @Post('permanent/office-day')
  officeDay(@Request() req, @Body() body: { employeeId: number; date: string; atOffice: boolean }) { return this.svc.setOfficeDay(this.v(req), body); }

  @Get('report')
  report(@Request() req, @Query('month') month?: string, @Query('year') year?: string, @Query('departmentId') departmentId?: string) {
    return this.svc.report(this.v(req), { month: Number(month) || undefined, year: Number(year) || undefined, departmentId: Number(departmentId) || undefined });
  }

  @Post(':id/admin-cancel')
  adminCancel(@Request() req, @Param('id', ParseIntPipe) id: number) { return this.svc.adminCancel(this.v(req), id); }

  @Get('pending')
  pending(@Request() req) { return this.svc.pending(this.v(req)); }

  @Get('can-approve')
  canApprove(@Request() req) { return this.svc.canApprove(this.v(req)); }

  @Post(':id/review')
  review(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: { action: 'APPROVE' | 'REJECT'; note?: string }) {
    return this.svc.review(this.v(req), id, body);
  }
}
