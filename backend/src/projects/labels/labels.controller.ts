import { Controller, Get, Post, Put, Delete, Param, Body, ParseIntPipe, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { LabelsService } from './labels.service';

@Controller('projects/:projectId')
@UseGuards(AuthGuard)
export class LabelsController {
  constructor(private labelsService: LabelsService) {}

  @Get('labels')
  getProjectLabels(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.labelsService.getProjectLabels(projectId);
  }

  @Post('labels')
  createLabel(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body('name') name: string,
    @Body('color') color: string
  ) {
    return this.labelsService.createLabel(projectId, name, color);
  }

  @Put('labels/:labelId')
  updateLabel(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('labelId', ParseIntPipe) labelId: number,
    @Body('name') name: string,
    @Body('color') color: string
  ) {
    return this.labelsService.updateLabel(projectId, labelId, name, color);
  }

  @Delete('labels/:labelId')
  deleteLabel(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('labelId', ParseIntPipe) labelId: number
  ) {
    return this.labelsService.deleteLabel(projectId, labelId);
  }

  @Post('issues/:issueId/labels/:labelId/toggle')
  toggleIssueLabel(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('issueId', ParseIntPipe) issueId: number,
    @Param('labelId', ParseIntPipe) labelId: number
  ) {
    return this.labelsService.toggleIssueLabel(projectId, issueId, labelId);
  }
}
