import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
@UseGuards(AuthGuard)
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** Every workflow and who is currently on it. */
  @Get('delegates')
  list(@Request() req) {
    return this.approvals.listAll(req.user.companyId);
  }

  @Post('delegates/:workflow')
  grant(
    @Request() req,
    @Param('workflow') workflow: string,
    @Body('employeeId', ParseIntPipe) employeeId: number,
  ) {
    return this.approvals.grant(
      req.user.companyId, workflow, employeeId, req.user.role, req.user.employeeId ?? null,
    );
  }

  @Delete('delegates/:workflow/:employeeId')
  revoke(
    @Request() req,
    @Param('workflow') workflow: string,
    @Param('employeeId', ParseIntPipe) employeeId: number,
  ) {
    return this.approvals.revoke(req.user.companyId, workflow, employeeId, req.user.role);
  }
}
