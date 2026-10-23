import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Req, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { TaskLocationsService } from './task-locations.service';

/**
 * The location master and the cross-task views. Changing the master is admin
 * only, checked in the service; reading it is open to anyone raising a task.
 */
@UseGuards(AuthGuard)
@Controller('task-locations')
export class TaskLocationsController {
  constructor(private readonly locations: TaskLocationsService) {}

  @Get()
  list(@Req() req, @Query('activeOnly') activeOnly?: string) {
    return this.locations.listLocations(req.user.companyId, activeOnly === 'true');
  }

  @Get('executions')
  executions(@Req() req, @Query() q: any) {
    return this.locations.executions(req.user.companyId, req.user.employeeId ?? null, req.user.role, q);
  }

  @Get('report')
  report(@Req() req, @Query() q: any) {
    return this.locations.report(req.user.companyId, req.user.employeeId ?? null, req.user.role, q);
  }

  @Post()
  create(@Req() req, @Body() body: any) {
    return this.locations.createLocation(req.user.companyId, req.user.role, body);
  }

  @Post('bulk')
  bulk(@Req() req, @Body() body: any) {
    return this.locations.bulkCreate(req.user.companyId, req.user.role, body);
  }

  @Put(':id')
  update(@Req() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.locations.updateLocation(req.user.companyId, req.user.role, id, body);
  }

  @Delete(':id')
  remove(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.locations.deleteLocation(req.user.companyId, req.user.role, id);
  }
}

/** One task's locations, nested under the task like the rest of the board's routes. */
@UseGuards(AuthGuard)
@Controller('projects/:projectId/issues/:issueId/locations')
export class IssueLocationsController {
  constructor(private readonly locations: TaskLocationsService) {}

  @Get()
  list(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('issueId', ParseIntPipe) issueId: number,
  ) {
    return this.locations.getForIssue(req.user.companyId, projectId, issueId, req.user.employeeId ?? null, req.user.role);
  }

  @Post()
  add(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('issueId', ParseIntPipe) issueId: number,
    @Body() body: any,
  ) {
    return this.locations.addLocations(req.user.companyId, projectId, issueId, req.user.employeeId ?? null, req.user.role, body);
  }

  /** Replace the task's one location: `{ locationId }`. */
  @Put()
  set(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('issueId', ParseIntPipe) issueId: number,
    @Body() body: { locationId: number },
  ) {
    return this.locations.setLocationFor(req.user.companyId, projectId, issueId, req.user.employeeId ?? null, req.user.role, body?.locationId);
  }

  @Patch(':locId')
  update(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('issueId', ParseIntPipe) issueId: number,
    @Param('locId', ParseIntPipe) locId: number,
    @Body() body: any,
  ) {
    return this.locations.updateRow(req.user.companyId, projectId, issueId, locId, req.user.employeeId ?? null, req.user.role, body);
  }

  @Delete(':locId')
  remove(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('issueId', ParseIntPipe) issueId: number,
    @Param('locId', ParseIntPipe) locId: number,
  ) {
    return this.locations.removeRow(req.user.companyId, projectId, issueId, locId, req.user.employeeId ?? null, req.user.role);
  }

  @Post(':locId/comments')
  comment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('issueId', ParseIntPipe) issueId: number,
    @Param('locId', ParseIntPipe) locId: number,
    @Body() body: { body: string },
  ) {
    return this.locations.addComment(req.user.companyId, projectId, issueId, locId, req.user.employeeId ?? null, req.user.role, body?.body);
  }

  @Post(':locId/time-log')
  logTime(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('issueId', ParseIntPipe) issueId: number,
    @Param('locId', ParseIntPipe) locId: number,
    @Body() body: any,
  ) {
    return this.locations.logTime(req.user.companyId, projectId, issueId, locId, req.user.employeeId ?? null, req.user.role, body);
  }

  @Post(':locId/evidence')
  evidence(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('issueId', ParseIntPipe) issueId: number,
    @Param('locId', ParseIntPipe) locId: number,
    @Body() body: any,
  ) {
    return this.locations.linkEvidence(req.user.companyId, projectId, issueId, locId, req.user.employeeId ?? null, req.user.role, body);
  }

  @Get(':locId/activity')
  activity(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('issueId', ParseIntPipe) issueId: number,
    @Param('locId', ParseIntPipe) locId: number,
  ) {
    return this.locations.activity(req.user.companyId, projectId, issueId, locId, req.user.employeeId ?? null, req.user.role);
  }
}
