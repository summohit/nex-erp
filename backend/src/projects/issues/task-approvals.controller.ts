import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { IssuesService } from './issues.service';

/**
 * Tasks waiting for approval, across every project (§PB8).
 *
 * Its own root-level controller rather than a route on IssuesController,
 * because that one is scoped to `/projects/:projectId/issues` and this question
 * — "what is waiting on me?" — is precisely the one nobody asks a project at a
 * time. The same reasoning budget-requests/pending already follows.
 */
@Controller()
@UseGuards(AuthGuard)
export class TaskApprovalsController {
  constructor(private readonly issues: IssuesService) {}

  @Get('task-approvals/pending')
  pending(@Req() req) {
    return this.issues.getPendingApprovals(
      req.user.companyId,
      req.user.employeeId ?? req.user.sub,
      req.user.role,
    );
  }
}
