import { Controller, Post, Get, Put, Patch, Delete, Body, Req, Param, ParseIntPipe, UseGuards, UseInterceptors, UploadedFile, UploadedFiles, BadRequestException } from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { IssuesService } from './issues.service';
import { AuthGuard } from '../../auth/auth.guard';
import { MAX_DOCUMENT_BYTES } from '../document-naming';

@UseGuards(AuthGuard)
@Controller('projects/:projectId/issues')
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  /**
   * The acting EMPLOYEE's id, for the columns that foreign-key to Employee.
   *
   * `req.user.sub` is a USER id. The two are different numbers, and passing one
   * where the other belongs only appears to work for the accounts whose ids
   * happen to coincide -- for everybody else it is a foreign key violation at
   * write time, surfacing as a 500 long after the upload itself succeeded.
   * There is deliberately no `?? req.user.sub` fallback here: a user with no
   * linked employee record cannot own an attachment, and saying so is better
   * than writing an id that means something else.
   */
  private actingEmployeeId(req: any): number {
    const employeeId = req.user?.employeeId;
    if (!employeeId) {
      throw new BadRequestException(
        'Your account is not linked to an employee record, so it cannot own an attachment.',
      );
    }
    return employeeId;
  }

  @Post()
  createIssue(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() data: any
  ) {
    const actorEmployeeId = req.user.employeeId ?? req.user.sub;
    return this.issuesService.createIssue(req.user.companyId, actorEmployeeId, projectId, data, req.user.role);
  }

  @Get()
  getIssues(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number
  ) {
    return this.issuesService.getIssues(
      req.user.companyId, projectId, req.user.employeeId ?? null, req.user.role,
    );
  }

  @Put(':id')
  updateIssue(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: any
  ) {
    const actorEmployeeId = req.user.employeeId ?? req.user.sub;
    return this.issuesService.updateIssue(req.user.companyId, actorEmployeeId, projectId, id, data, req.user.role);
  }

  @Put(':id/archive')
  toggleArchive(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number
  ) {
    const actorEmployeeId = req.user.employeeId ?? req.user.sub;
    return this.issuesService.toggleArchive(req.user.companyId, actorEmployeeId, projectId, id, req.user.role);
  }

  @Post(':id/review')
  reviewIssue(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { action: 'APPROVE' | 'REJECT', reason?: string }
  ) {
    const actorEmployeeId = req.user.employeeId ?? req.user.sub;
    return this.issuesService.reviewIssue(req.user.companyId, actorEmployeeId, projectId, id, data);
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

  @Post(':id/time-log')
  addManualTimeLog(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { durationMin: number }
  ) {
    return this.issuesService.addManualTimeLog(req.user.companyId, req.user.sub, projectId, id, body);
  }

  /** Sets the caller's total minutes for this issue on one day (timesheet grid). */
  @Put(':id/time-log/day')
  setDayTimeTotal(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { date: string; durationMin: number }
  ) {
    return this.issuesService.setDayTimeTotal(req.user.companyId, req.user.sub, projectId, id, body);
  }

  @Get(':id/comments')
  getComments(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.issuesService.getComments(req.user.companyId, projectId, id);
  }

  @Get(':id/activities')
  getActivities(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.issuesService.getActivities(req.user.companyId, projectId, id);
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
    return this.issuesService.createChecklist(req.user.companyId, projectId, id, title, req.user.employeeId ?? req.user.sub, req.user.role);
  }

  @Put(':id/checklists/:checklistId')
  updateChecklist(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('checklistId', ParseIntPipe) checklistId: number,
    @Body('title') title: string
  ) {
    return this.issuesService.updateChecklist(req.user.companyId, projectId, id, checklistId, title, req.user.employeeId ?? req.user.sub, req.user.role);
  }

  @Delete(':id/checklists/:checklistId')
  deleteChecklist(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('checklistId', ParseIntPipe) checklistId: number
  ) {
    return this.issuesService.deleteChecklist(req.user.companyId, projectId, id, checklistId, req.user.employeeId ?? req.user.sub, req.user.role);
  }

  @Post(':id/checklists/:checklistId/items')
  addChecklistItem(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('checklistId', ParseIntPipe) checklistId: number,
    @Body('title') title: string
  ) {
    return this.issuesService.addChecklistItem(req.user.companyId, projectId, id, checklistId, title, req.user.employeeId ?? req.user.sub, req.user.role);
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
    return this.issuesService.updateChecklistItem(req.user.companyId, projectId, id, checklistId, itemId, data, req.user.employeeId ?? req.user.sub, req.user.role);
  }

  @Delete(':id/checklists/:checklistId/items/:itemId')
  deleteChecklistItem(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('checklistId', ParseIntPipe) checklistId: number,
    @Param('itemId', ParseIntPipe) itemId: number
  ) {
    return this.issuesService.deleteChecklistItem(req.user.companyId, projectId, id, checklistId, itemId, req.user.employeeId ?? req.user.sub, req.user.role);
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
    const actorEmployeeId = req.user.employeeId ?? req.user.sub;
    return this.issuesService.toggleIssueMember(req.user.companyId, projectId, id, employeeId, actorEmployeeId, req.user.role);
  }

  /**
   * Evidence goes up several files at a time (§2).
   *
   * Accepts both shapes on purpose: `files` for a multi-select, and a single
   * `file` for anything still posting one. A task's attachments are its
   * evidence, and evidence arrives in batches -- making people repeat the
   * picker once per document is how attachments get left off.
   */
  @Post(':id/attachments/upload')
  @UseInterceptors(
    FileFieldsInterceptor(
      [{ name: 'files', maxCount: 20 }, { name: 'file', maxCount: 1 }],
      { limits: { fileSize: MAX_DOCUMENT_BYTES } },
    ),
  )
  async uploadAttachment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() uploaded: { files?: Express.Multer.File[]; file?: Express.Multer.File[] },
    // §2: names the user gave the files before saving, positionally matched to
    // `files`. Sent as repeated fields, which arrives as a string when there is
    // only one.
    @Body('names') names?: string | string[],
  ) {
    const incoming = [...(uploaded?.files || []), ...(uploaded?.file || [])];
    if (!incoming.length) throw new BadRequestException('No file provided');

    const wanted = names === undefined ? [] : Array.isArray(names) ? names : [names];

    // Sequential rather than parallel: ImageKit is rate limited, and twenty
    // simultaneous uploads is how a batch half-fails.
    const results: any[] = [];
    for (const [index, f] of incoming.entries()) {
      results.push(
        await this.issuesService.uploadAttachmentToImageKit(
          req.user.companyId, this.actingEmployeeId(req), projectId, id, f, wanted[index],
        ),
      );
    }
    // A single upload still answers with the attachment itself, so nothing
    // that posted one file has to learn a new response shape.
    return incoming.length === 1 ? results[0] : results;
  }

  @Post(':id/attachments/link')
  addLinkAttachment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body('linkUrl') linkUrl: string,
    @Body('linkName') linkName?: string
  ) {
    return this.issuesService.addLinkAttachment(req.user.companyId, this.actingEmployeeId(req), projectId, id, linkUrl, linkName);
  }

  /** §2: rename a task attachment. The stored file is untouched. */
  @Patch(':id/attachments/:attachmentId')
  renameAttachment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Body('name') name: string,
  ) {
    return this.issuesService.renameAttachment(
      req.user.companyId, projectId, id, attachmentId, name,
    );
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
