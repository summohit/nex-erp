import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Query, ParseIntPipe } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('recruitment/applications')
@UseGuards(AuthGuard)
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Get()
  findAll(@Request() req, @Query('jobId') jobId?: string) {
    const parsedJobId = jobId ? parseInt(jobId, 10) : undefined;
    return this.applicationsService.findAll(req.user.companyId, parsedJobId);
  }

  // --- Static Endpoints ---

  @Get('my-interviews')
  getMyInterviews(@Request() req) {
    return this.applicationsService.getMyInterviews(req.user.companyId, req.user.sub);
  }

  @Get('analytics/dashboard')
  getAnalytics(@Request() req) {
    return this.applicationsService.getAnalytics(req.user.companyId);
  }

  @Put('interviews/:interviewId')
  updateInterview(@Request() req, @Param('interviewId', ParseIntPipe) interviewId: number, @Body() body: any) {
    return this.applicationsService.updateInterview(interviewId, req.user.companyId, body);
  }

  @Delete('interviews/:interviewId')
  deleteInterview(@Request() req, @Param('interviewId', ParseIntPipe) interviewId: number) {
    return this.applicationsService.deleteInterview(interviewId, req.user.companyId);
  }

  // --- Dynamic Application Endpoints (:id) ---

  @Get(':id')
  findOne(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.findOne(id, req.user.companyId);
  }

  @Put(':id/status')
  updateStatus(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('status') status: string) {
    return this.applicationsService.updateStatus(id, req.user.companyId, status);
  }

  @Post(':id/onboard')
  onboardCandidate(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.onboardCandidate(id, req.user.companyId);
  }

  @Get(':id/interviews')
  getInterviews(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.getInterviews(id, req.user.companyId);
  }

  @Post(':id/interviews')
  scheduleInterview(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.applicationsService.scheduleInterview(id, req.user.companyId, body);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.remove(id, req.user.companyId);
  }
}
