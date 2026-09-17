import {
  Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards, ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { ProjectTicketsService } from './project-tickets.service';

/**
 * Project tickets (§29, §30).
 *
 * Two shapes of route, because there are two people here: a project manager
 * working inside one project, and an administrator looking across all of them
 * for whatever is waiting on a decision.
 */
@UseGuards(AuthGuard)
@Controller()
export class ProjectTicketsController {
  constructor(private readonly tickets: ProjectTicketsService) {}

  /** Everything awaiting approval, across projects. Declared before the
   *  project-scoped routes so "pending" is never read as a project id. */
  @Get('project-tickets/pending')
  pending(@Req() req) {
    return this.tickets.pending(req.user.companyId, req.user.role);
  }

  @Get('projects/:projectId/tickets')
  list(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query('status') status?: string,
  ) {
    return this.tickets.list(req.user.companyId, projectId, status);
  }

  @Post('projects/:projectId/tickets')
  create(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() body: any,
  ) {
    return this.tickets.create(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, projectId, body,
    );
  }

  @Put('project-tickets/:id')
  update(@Req() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.tickets.update(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, id, body,
    );
  }

  @Post('project-tickets/:id/review')
  review(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { decision: 'APPROVED' | 'REJECTED'; reason?: string },
  ) {
    return this.tickets.review(
      req.user.companyId, req.user.employeeId ?? null, req.user.role,
      id, body?.decision, body?.reason,
    );
  }

  @Post('project-tickets/:id/cancel')
  cancel(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.tickets.cancel(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, id,
    );
  }
}
