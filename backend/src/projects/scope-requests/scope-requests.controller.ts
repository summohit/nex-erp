import {
  Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { ScopeRequestsService } from './scope-requests.service';

@Controller()
@UseGuards(AuthGuard)
export class ScopeRequestsController {
  constructor(private readonly scopeRequests: ScopeRequestsService) {}

  /** The queue, for the Requests tab. Company-wide. */
  @Get('scope-requests/pending')
  pending(@Req() req) {
    return this.scopeRequests.pending(req.user.companyId);
  }

  @Get('projects/:projectId/scope-requests')
  listForProject(@Req() req, @Param('projectId', ParseIntPipe) projectId: number) {
    return this.scopeRequests.listForProject(req.user.companyId, projectId);
  }

  @Post('projects/:projectId/scope-requests')
  create(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() data: {
      title: string; scope: string; body: string;
      attachments?: { url: string; name: string; sizeBytes?: number }[];
    },
  ) {
    return this.scopeRequests.create(
      req.user.companyId, projectId, req.user.employeeId ?? req.user.sub, data,
    );
  }

  @Post('scope-requests/:id/review')
  review(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: {
      decision: 'APPROVED' | 'REJECTED'; note?: string;
      /** Edit & approve: the administrator's corrected wording or classification. */
      edits?: { title?: string; scope?: string; body?: string };
      editReason?: string;
    },
  ) {
    return this.scopeRequests.review(
      req.user.companyId, id, data.decision, req.user.role,
      req.user.employeeId ?? null, data.note, data.edits, data.editReason,
    );
  }
}
