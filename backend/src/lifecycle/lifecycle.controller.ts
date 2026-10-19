import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { LifecycleService } from './lifecycle.service';

/** Probation, notice period and PIPs (19 Oct 2026). */
@Controller('lifecycle')
@UseGuards(AuthGuard)
export class LifecycleController {
  constructor(private readonly svc: LifecycleService) {}

  private v(req: any) {
    return { companyId: req.user.companyId, role: req.user.role, employeeId: req.user.employeeId ?? null };
  }

  @Get('overview')
  overview(@Request() req) { return this.svc.overview(this.v(req)); }

  @Put('probation/:employeeId')
  setProbation(@Request() req, @Param('employeeId', ParseIntPipe) id: number, @Body() body: { months?: number; endDate?: string }) {
    return this.svc.setProbation(this.v(req), id, body);
  }

  @Post('probation/:employeeId/confirm')
  confirmProbation(@Request() req, @Param('employeeId', ParseIntPipe) id: number) {
    return this.svc.confirmProbation(this.v(req), id);
  }

  @Delete('probation/:employeeId')
  clearProbation(@Request() req, @Param('employeeId', ParseIntPipe) id: number) {
    return this.svc.clearProbation(this.v(req), id);
  }

  @Get('pips/mine')
  myPips(@Request() req) { return this.svc.myPips(this.v(req)); }

  @Get('pips/history')
  pipHistory(@Request() req) { return this.svc.pipHistory(this.v(req)); }

  @Post('pips')
  createPip(@Request() req, @Body() body: any) { return this.svc.createPip(this.v(req), body); }

  @Get('pips/:id')
  getPip(@Request() req, @Param('id', ParseIntPipe) id: number) { return this.svc.getPip(this.v(req), id); }

  @Post('pips/:id/check-ins')
  addCheckIn(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: { note: string }) {
    return this.svc.addCheckIn(this.v(req), id, body?.note);
  }

  @Put('pips/:id')
  updatePip(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.updatePip(this.v(req), id, body);
  }

  @Post('pips/:id/acknowledge')
  acknowledge(@Request() req, @Param('id', ParseIntPipe) id: number) { return this.svc.acknowledge(this.v(req), id); }
}
