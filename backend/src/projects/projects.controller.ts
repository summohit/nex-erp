import { Controller, Post, Get, Put, Delete, Patch, Body, Req, UseGuards, Param, ParseIntPipe, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProjectsService } from './projects.service';
import { ProjectAiService } from './project-ai.service';
import { AuthGuard } from '../auth/auth.guard';
import { MAX_DOCUMENT_BYTES } from './document-naming';

@UseGuards(AuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectAiService: ProjectAiService
  ) {}

  @Post()
  createProject(@Req() req, @Body() data: any) {
    return this.projectsService.createProject(req.user.companyId, req.user.employeeId ?? req.user.sub, data);
  }

  @Post('ai-onboarding')
  createAiProject(@Req() req, @Body() data: any) {
    return this.projectsService.createAiProject(req.user.companyId, req.user.employeeId ?? req.user.sub, data);
  }

  @Post(':id/documents')
  // An explicit ceiling, rather than multer's default of none. Without it an
  // oversized file is only stopped by the reverse proxy, which answers 413
  // with an HTML error page and no message the UI can show.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  uploadProjectDocument(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    // Optional: the name to store it under, when the user renamed the file
    // before it was uploaded. The extension is preserved either way.
    @Body('name') name?: string,
  ) {
    // employeeId, not sub. ProjectDocument.uploadedBy is a foreign key to
    // Employee, and this was passing the User id — so "uploaded by" resolved
    // to whichever employee happened to share that number, or to nobody.
    return this.projectsService.uploadProjectDocument(
      req.user.companyId, id, req.user.employeeId ?? req.user.sub, file, name,
    );
  }

  @Get(':id/documents')
  listProjectDocuments(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.projectsService.listProjectDocuments(req.user.companyId, id);
  }

  /** Renames the document. The extension is kept whatever the caller sends. */
  @Patch(':id/documents/:documentId')
  renameProjectDocument(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Body('name') name: string,
  ) {
    return this.projectsService.renameProjectDocument(req.user.companyId, id, documentId, name);
  }

  @Delete(':id/documents/:documentId')
  deleteProjectDocument(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) documentId: number,
  ) {
    return this.projectsService.deleteProjectDocument(req.user.companyId, id, documentId);
  }

  @Post(':id/analyze')
  analyzeProjectDocuments(
    @Req() req, 
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any
  ) {
    return this.projectAiService.analyzeProjectDocuments(
      req.user.companyId, 
      id, 
      body?.resourceConstraints, 
      body?.aiModel
    );
  }

  @Get(':id/analysis')
  getProjectAnalysis(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.projectsService.getProjectAnalysis(req.user.companyId, id);
  }

  @Post(':id/kickoff')
  kickoffProject(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.projectsService.kickoffProject(req.user.companyId, id);
  }

  /** Numbers for the project tab strip, in one call rather than five. */
  @Get(':id/tab-counts')
  getTabCounts(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.projectsService.getTabCounts(req.user.companyId, id);
  }

  @Get(':id/activity')
  getProjectActivity(@Req() req, @Param('id', ParseIntPipe) id: number, @Query('limit') limit?: string) {
    return this.projectsService.getProjectActivity(req.user.companyId, id, limit ? +limit : 50);
  }

  @Get('timesheets/my-week')
  getMyTimesheets(@Req() req, @Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.projectsService.getMyTimesheets(req.user.companyId, req.user.sub, startDate, endDate);
  }

  @Get()
  getProjects(@Req() req) {
    return this.projectsService.getProjects(req.user.companyId, req.user.sub, req.user.role);
  }

  @Get('archived')
  getArchivedProjects(@Req() req) {
    return this.projectsService.getArchivedProjects(req.user.companyId, req.user.sub, req.user.role);
  }

  @Get(':id')
  getProjectDetails(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.projectsService.getProjectDetails(req.user.companyId, id, req.user.sub, req.user.role);
  }

  @Get(':id/summary')
  getProjectSummary(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.projectsService.getProjectSummary(req.user.companyId, id);
  }

  @Patch(':id/archive')
  archiveProject(@Req() req, @Param('id', ParseIntPipe) id: number, @Body('force') force: boolean) {
    return this.projectsService.archiveProject(req.user.companyId, id, force);
  }

  @Patch(':id/unarchive')
  unarchiveProject(
    @Req() req,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.projectsService.unarchiveProject(req.user.companyId, id);
  }

  @Put(':id')
  updateProject(@Req() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.projectsService.updateProject(req.user.companyId, id, data);
  }

  @Get(':id/members')
  getProjectMembers(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.projectsService.getProjectMembers(req.user.companyId, id);
  }

  @Put(':id/star')
  toggleProjectStar(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.projectsService.toggleProjectStar(req.user.companyId, id, req.user.sub);
  }

  @Post(':id/members')
  addProjectMember(@Req() req, @Param('id', ParseIntPipe) id: number, @Body() data: { employeeId: number, role?: string }) {
    const actorEmployeeId = req.user.employeeId ?? req.user.sub;
    return this.projectsService.addProjectMember(req.user.companyId, id, data.employeeId, data.role || 'MEMBER', actorEmployeeId, req.user.role);
  }

  @Delete(':id/members/:employeeId')
  removeProjectMember(
    @Req() req, 
    @Param('id', ParseIntPipe) id: number, 
    @Param('employeeId', ParseIntPipe) employeeId: number
  ) {
    return this.projectsService.removeProjectMember(req.user.companyId, id, employeeId);
  }
}
