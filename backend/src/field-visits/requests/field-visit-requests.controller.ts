import {
  Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { FieldVisitRequestsService } from './field-visit-requests.service';
// `import type` because emitDecoratorMetadata would otherwise try to emit a
// runtime reference to an interface that does not exist at runtime.
import type { FieldVisitRequestInput } from './field-visit-requests.service';

/**
 * Field Visit Requests (§1–§3): raised by the project manager, ruled on by an
 * administrator.
 *
 * Separate from FieldVisitsController, which owns the visit somebody starts
 * from their phone. One is a plan that has to be approved; the other is a trip
 * already happening.
 */
@UseGuards(AuthGuard)
@Controller('field-visit-requests')
export class FieldVisitRequestsController {
  constructor(private readonly requests: FieldVisitRequestsService) {}

  @Get()
  list(@Req() req, @Query('status') status?: string, @Query('projectId') projectId?: string) {
    return this.requests.list(
      req.user.companyId, req.user.role, req.user.employeeId ?? null,
      { status, projectId },
    );
  }

  @Get(':id')
  getOne(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.requests.getOne(
      req.user.companyId, req.user.role, req.user.employeeId ?? null, id,
    );
  }

  @Get(':id/timeline')
  timeline(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.requests.timeline(
      req.user.companyId, req.user.role, req.user.employeeId ?? null, id,
    );
  }

  @Post()
  create(@Req() req, @Body() body: FieldVisitRequestInput) {
    return this.requests.create(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, body,
    );
  }

  @Patch(':id')
  update(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: FieldVisitRequestInput,
  ) {
    return this.requests.update(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, id, body,
    );
  }

  @Post(':id/submit')
  submit(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.requests.submit(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, id,
    );
  }

  @Post(':id/approve')
  approve(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.requests.approve(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, id,
    );
  }

  @Post(':id/reject')
  reject(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ) {
    return this.requests.reject(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, id, body?.reason,
    );
  }

  /** §10: pull a submitted request back to a draft before anybody rules on it. */
  @Post(':id/withdraw')
  withdraw(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.requests.withdraw(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, id,
    );
  }

  /**
   * §10: propose a change to an approved trip.
   *
   * The body is a whole request, not a patch — the same shape the form
   * submits — because the approver rules on what the trip would become, not on
   * a list of edits.
   */
  @Post(':id/request-modification')
  requestModification(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: FieldVisitRequestInput,
  ) {
    return this.requests.requestModification(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, id, body,
    );
  }

  @Post(':id/modification/approve')
  approveModification(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.requests.approveModification(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, id,
    );
  }

  @Post(':id/modification/reject')
  rejectModification(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ) {
    return this.requests.rejectModification(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, id, body?.reason,
    );
  }

  @Post(':id/cancel')
  cancel(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ) {
    return this.requests.cancel(
      req.user.companyId, req.user.employeeId ?? null, req.user.role, id, body?.reason,
    );
  }
}
