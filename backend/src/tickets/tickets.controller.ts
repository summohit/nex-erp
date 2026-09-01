import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Request,
  UseGuards, ParseIntPipe,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('tickets')
@UseGuards(AuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  create(@Request() req, @Body() body: any) {
    return this.ticketsService.create(req.user.companyId, req.user.employeeId, body);
  }

  @Get('stats')
  getStats(@Request() req) {
    return this.ticketsService.getStats(req.user.companyId, req.user);
  }

  /** What the caller may do — drives which triage controls the UI renders. */
  @Get('my-permissions')
  myPermissions(@Request() req) {
    return this.ticketsService.myPermissions(req.user.companyId, req.user);
  }

  @Get()
  findAll(@Request() req, @Query() query: any) {
    return this.ticketsService.findAll(req.user.companyId, req.user, query);
  }

  // ─── ANALYTICS ─────────────────────────────────────────────────────────────

  @Get('analytics/summary')
  getAnalytics(@Request() req, @Query('days') days?: string) {
    return this.ticketsService.getAnalytics(req.user.companyId, days ? Number(days) : 30);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.ticketsService.findOne(req.user.companyId, id);
  }

  @Get(':id/assignable-members')
  assignableMembers(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.ticketsService.assignableMembers(req.user.companyId, id);
  }

  @Patch(':id')
  update(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.ticketsService.update(req.user.companyId, id, req.user.employeeId, body, req.user);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.ticketsService.remove(req.user.companyId, id, req.user);
  }

  // ─── COMMENTS ──────────────────────────────────────────────────────────────

  @Post(':id/comments')
  addComment(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('body') body: string) {
    return this.ticketsService.addComment(req.user.companyId, id, req.user.employeeId, body);
  }

  @Patch(':id/comments/:cid')
  updateComment(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('cid', ParseIntPipe) cid: number,
    @Body('body') body: string,
  ) {
    return this.ticketsService.updateComment(req.user.companyId, id, cid, req.user.employeeId, body);
  }

  @Delete(':id/comments/:cid')
  deleteComment(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('cid', ParseIntPipe) cid: number,
  ) {
    return this.ticketsService.deleteComment(req.user.companyId, id, cid, req.user.employeeId, req.user.role);
  }

  // ─── ATTACHMENTS ───────────────────────────────────────────────────────────

  @Post(':id/attachments')
  addAttachment(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { fileName: string; fileUrl: string; fileSize?: number }
  ) {
    return this.ticketsService.addAttachment(req.user.companyId, id, req.user.employeeId, body);
  }

  // ─── TIME TRACKING ─────────────────────────────────────────────────────────

  @Get(':id/time-entries')
  getTimeEntries(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.ticketsService.getTimeEntries(req.user.companyId, id);
  }

  @Post(':id/timer/start')
  startTimer(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.ticketsService.startTimer(req.user.companyId, id, req.user.employeeId);
  }

  @Post(':id/timer/stop')
  stopTimer(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('notes') notes?: string) {
    return this.ticketsService.stopTimer(req.user.companyId, id, req.user.employeeId, notes);
  }
}
