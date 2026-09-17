import {
  Controller, Get, Post, Body, Param, Req, UseGuards, ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { BudgetRequestsService } from './budget-requests.service';

/**
 * Project budget and hours increase requests (§25).
 *
 * Two audiences: a project manager inside one project, and an administrator
 * looking across all of them for what is waiting on a decision.
 */
@UseGuards(AuthGuard)
@Controller()
export class BudgetRequestsController {
  constructor(private readonly requests: BudgetRequestsService) {}

  /** Declared before the id routes so "pending" is never read as an id. */
  @Get('budget-requests/pending')
  pending(@Req() req) {
    return this.requests.pending(req.user.companyId, req.user.role);
  }

  @Get('projects/:projectId/budget-requests')
  list(@Req() req, @Param('projectId', ParseIntPipe) projectId: number) {
    return this.requests.list(
      req.user.companyId, projectId, req.user.role, req.user.employeeId ?? null,
    );
  }

  @Post('projects/:projectId/budget-requests')
  create(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() body: any,
  ) {
    return this.requests.create(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, projectId, body,
    );
  }

  @Post('budget-requests/:id/review')
  review(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { decision: 'APPROVED' | 'REJECTED'; reason?: string },
  ) {
    return this.requests.review(
      req.user.companyId, req.user.employeeId ?? null, req.user.role,
      id, body?.decision, body?.reason,
    );
  }

  @Post('budget-requests/:id/cancel')
  cancel(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.requests.cancel(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, id,
    );
  }
}
