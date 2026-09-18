import {
  Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards, ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { NoticesService } from './notices.service';

/** The company notice board. */
@UseGuards(AuthGuard)
@Controller('notices')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  /**
   * What the dashboard shows the person looking at it.
   *
   * Declared before ':id' routes so "dashboard" is never read as an id.
   */
  @Get('dashboard')
  forDashboard(@Req() req) {
    return this.notices.forDashboard(req.user.companyId, req.user.sub);
  }

  /** Every notice, for the admin screen. */
  @Get()
  list(@Req() req) {
    return this.notices.list(req.user.companyId, req.user.role);
  }

  @Post()
  create(@Req() req, @Body() body: any) {
    return this.notices.create(
      req.user.companyId, req.user.employeeId ?? req.user.sub, req.user.role, body,
    );
  }

  @Put(':id')
  update(@Req() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.notices.update(req.user.companyId, req.user.role, id, body);
  }

  /** Retires the notice; the record of what was announced is kept. */
  @Delete(':id')
  retire(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.notices.retire(req.user.companyId, req.user.role, id);
  }

  @Post(':id/read')
  markRead(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.notices.markRead(req.user.companyId, req.user.sub, id);
  }
}
