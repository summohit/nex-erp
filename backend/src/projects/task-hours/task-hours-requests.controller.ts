import {
  Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { TaskHoursRequestsService } from './task-hours-requests.service';

/**
 * Additional-hours requests on a task (§3) and the tracking view over all of
 * them (§4).
 */
@UseGuards(AuthGuard)
@Controller()
export class TaskHoursRequestsController {
  constructor(private readonly requests: TaskHoursRequestsService) {}

  /** §4: every request the caller is entitled to see. */
  @Get('task-hours-requests')
  listAll(@Req() req, @Query('status') status?: string, @Query('projectId') projectId?: string) {
    return this.requests.listAll(
      req.user.companyId, req.user.role, req.user.employeeId ?? null,
      { status, projectId },
    );
  }

  @Get('task-hours-requests/:requestId/timeline')
  timeline(@Req() req, @Param('requestId', ParseIntPipe) requestId: number) {
    return this.requests.timeline(req.user.companyId, requestId);
  }

  @Get('issues/:issueId/hours-requests')
  listForIssue(@Req() req, @Param('issueId', ParseIntPipe) issueId: number) {
    return this.requests.listForIssue(
      req.user.companyId, issueId, req.user.role, req.user.employeeId ?? null,
    );
  }

  @Post('issues/:issueId/hours-requests')
  create(
    @Req() req,
    @Param('issueId', ParseIntPipe) issueId: number,
    @Body() body: { requestedHours: number; reason?: string },
  ) {
    return this.requests.create(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, issueId, body,
    );
  }

  @Patch('task-hours-requests/:requestId/review')
  review(
    @Req() req,
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body() body: { decision: 'APPROVED' | 'REJECTED'; approvedHours?: number; reason?: string },
  ) {
    return this.requests.review(
      req.user.companyId, req.user.employeeId ?? null, req.user.role,
      requestId, body?.decision, body,
    );
  }
}
