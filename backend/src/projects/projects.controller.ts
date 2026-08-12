import { Controller, Post, Get, Put, Delete, Patch, Body, Req, UseGuards, Param, ParseIntPipe, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProjectsService } from './projects.service';
import { ProjectAiService } from './project-ai.service';
import { AuthGuard } from '../auth/auth.guard';

@UseGuards(AuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectAiService: ProjectAiService
  ) {}

  @Post()
  createProject(@Req() req, @Body() data: any) {
    return this.projectsService.createProject(req.user.companyId, req.user.sub, data);
  }

  @Post('ai-onboarding')
  createAiProject(@Req() req, @Body() data: any) {
    return this.projectsService.createAiProject(req.user.companyId, req.user.sub, data);
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file'))
  uploadProjectDocument(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File
  ) {
    return this.projectsService.uploadProjectDocument(req.user.companyId, id, req.user.sub, file);
  }

  @Post(':id/analyze')
  analyzeProjectDocuments(
    @Req() req, 
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any
  ) {
    return this.projectAiService.analyzeProjectDocuments(req.user.companyId, id, body?.resourceConstraints);
  }

  @Get(':id/analysis')
  getProjectAnalysis(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.projectsService.getProjectAnalysis(req.user.companyId, id);
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
    return this.projectsService.addProjectMember(req.user.companyId, id, data.employeeId, data.role || 'MEMBER');
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
