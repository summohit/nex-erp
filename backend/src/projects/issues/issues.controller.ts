import { Controller, Post, Get, Put, Body, Req, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { IssuesService } from './issues.service';
import { AuthGuard } from '../../auth/auth.guard';

@UseGuards(AuthGuard)
@Controller('projects/:projectId/issues')
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Post()
  createIssue(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() data: any
  ) {
    return this.issuesService.createIssue(req.user.companyId, req.user.sub, projectId, data);
  }

  @Get()
  getIssues(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number
  ) {
    return this.issuesService.getIssues(req.user.companyId, projectId);
  }

  @Put(':id')
  updateIssue(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: any
  ) {
    return this.issuesService.updateIssue(req.user.companyId, req.user.sub, projectId, id, data);
  }

  @Post(':id/time-start')
  startTimeTracking(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.issuesService.startTimeTracking(req.user.companyId, req.user.sub, projectId, id);
  }

  @Post(':id/time-stop')
  stopTimeTracking(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.issuesService.stopTimeTracking(req.user.companyId, req.user.sub, projectId, id);
  }
}
