import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { VisitLocationRequestsService } from './visit-location-requests.service';
import type { VisitLocationRequestInput } from './visit-location-requests.service';

@UseGuards(AuthGuard)
@Controller('visit-location-requests')
export class VisitLocationRequestsController {
  constructor(private readonly requests: VisitLocationRequestsService) {}

  @Get('capabilities')
  capabilities(@Req() req) {
    return this.requests.capabilities(
      req.user.companyId,
      req.user.employeeId ?? null,
      req.user.role,
    );
  }

  @Get()
  list(@Req() req) {
    return this.requests.list(
      req.user.companyId,
      req.user.employeeId ?? null,
      req.user.role,
    );
  }

  @Post()
  create(@Req() req, @Body() body: VisitLocationRequestInput) {
    return this.requests.create(
      req.user.companyId,
      req.user.employeeId ?? null,
      req.user.role,
      body,
    );
  }

  @Post(':id/review')
  review(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { decision: 'APPROVED' | 'REJECTED'; reason?: string },
  ) {
    return this.requests.review(
      req.user.companyId,
      req.user.employeeId ?? null,
      req.user.role,
      id,
      body?.decision,
      body?.reason,
    );
  }
}
