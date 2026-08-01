import { Controller, Post, Get, Put, Delete, Body, Req, Param, ParseIntPipe, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  @Get(':id/comments')
  getComments(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.issuesService.getComments(req.user.companyId, projectId, id);
  }

  @Post(':id/comments')
  addComment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body('body') body: string
  ) {
    return this.issuesService.addComment(req.user.companyId, req.user.sub, projectId, id, body);
  }

  @Delete(':id/comments/:commentId')
  deleteComment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('commentId', ParseIntPipe) commentId: number
  ) {
    return this.issuesService.deleteComment(req.user.companyId, projectId, id, commentId);
  }

  @Get(':id/checklists')
  getChecklists(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.issuesService.getChecklists(req.user.companyId, projectId, id);
  }

  @Post(':id/checklists')
  createChecklist(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body('title') title: string
  ) {
    return this.issuesService.createChecklist(req.user.companyId, projectId, id, title);
  }

  @Put(':id/checklists/:checklistId')
  updateChecklist(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('checklistId', ParseIntPipe) checklistId: number,
    @Body('title') title: string
  ) {
    return this.issuesService.updateChecklist(req.user.companyId, projectId, id, checklistId, title);
  }

  @Delete(':id/checklists/:checklistId')
  deleteChecklist(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('checklistId', ParseIntPipe) checklistId: number
  ) {
    return this.issuesService.deleteChecklist(req.user.companyId, projectId, id, checklistId);
  }

  @Post(':id/checklists/:checklistId/items')
  addChecklistItem(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('checklistId', ParseIntPipe) checklistId: number,
    @Body('title') title: string
  ) {
    return this.issuesService.addChecklistItem(req.user.companyId, projectId, id, checklistId, title);
  }

  @Put(':id/checklists/:checklistId/items/:itemId')
  updateChecklistItem(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('checklistId', ParseIntPipe) checklistId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() data: any
  ) {
    return this.issuesService.updateChecklistItem(req.user.companyId, projectId, id, checklistId, itemId, data);
  }

  @Delete(':id/checklists/:checklistId/items/:itemId')
  deleteChecklistItem(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('checklistId', ParseIntPipe) checklistId: number,
    @Param('itemId', ParseIntPipe) itemId: number
  ) {
    return this.issuesService.deleteChecklistItem(req.user.companyId, projectId, id, checklistId, itemId);
  }

  @Post(':id/checklist/generate')
  generateChecklist(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.issuesService.generateChecklist(req.user.companyId, projectId, id);
  }

  @Get('company-members')
  getCompanyMembers(@Req() req) {
    return this.issuesService.getCompanyMembers(req.user.companyId);
  }

  @Post(':id/members/toggle')
  toggleMember(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body('employeeId', ParseIntPipe) employeeId: number
  ) {
    return this.issuesService.toggleIssueMember(req.user.companyId, projectId, id, employeeId);
  }

  @Post(':id/attachments/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File
  ) {
    return this.issuesService.uploadAttachmentToImageKit(req.user.companyId, req.user.sub, projectId, id, file);
  }

  @Post(':id/attachments/link')
  addLinkAttachment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body('linkUrl') linkUrl: string,
    @Body('linkName') linkName?: string
  ) {
    return this.issuesService.addLinkAttachment(req.user.companyId, req.user.sub, projectId, id, linkUrl, linkName);
  }

  @Delete(':id/attachments/:attachmentId')
  deleteAttachment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number
  ) {
    return this.issuesService.deleteAttachment(req.user.companyId, projectId, id, attachmentId);
  }

  @Post(':id/attachments/:attachmentId/toggle-cover')
  toggleCoverAttachment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number
  ) {
    return this.issuesService.toggleCoverAttachment(req.user.companyId, projectId, id, attachmentId);
  }
}
