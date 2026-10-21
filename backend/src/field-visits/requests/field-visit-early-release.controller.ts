import { Body, Controller, Get, Param, ParseIntPipe, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { FieldVisitEarlyReleaseService } from './field-visit-early-release.service';

/** Field visit early release (21 Oct 2026). */
@Controller('field-visit-early-release')
@UseGuards(AuthGuard)
export class FieldVisitEarlyReleaseController {
  constructor(private readonly svc: FieldVisitEarlyReleaseService) {}
  private v(req: any) { return { companyId: req.user.companyId, role: req.user.role, employeeId: req.user.employeeId ?? null }; }

  @Get('mine') mine(@Request() req) { return this.svc.mine(this.v(req)); }
  @Get('pending') pending(@Request() req) { return this.svc.pending(this.v(req)); }
  @Get('can-approve') canApprove(@Request() req) { return this.svc.canApprove(this.v(req)); }
  @Post() create(@Request() req, @Body() body: any) { return this.svc.create(this.v(req), body); }
  @Post(':id/cancel') cancel(@Request() req, @Param('id', ParseIntPipe) id: number) { return this.svc.cancel(this.v(req), id); }
  @Post(':id/review') review(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.svc.review(this.v(req), id, body); }
}
