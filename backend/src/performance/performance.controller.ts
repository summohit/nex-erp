import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards, Query } from '@nestjs/common';
import { PerformanceService } from './performance.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('performance')
@UseGuards(AuthGuard)
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  // --- Goals ---
  @Get('goals/me')
  async getMyGoals(@Req() req) {
    return this.performanceService.getMyGoals(req.user.employeeId);
  }

  @Post('goals')
  async createGoal(@Req() req, @Body() data: any) {
    return this.performanceService.createGoal(req.user.employeeId, req.user.companyId, data);
  }

  @Put('goals/:id/status')
  async updateGoalStatus(@Req() req, @Param('id') id: string, @Body() data: { status: string }) {
    return this.performanceService.updateGoalStatus(+id, data.status, req.user.employeeId);
  }

  @Put('goals/:id/progress')
  async updateGoalProgress(@Req() req, @Param('id') id: string, @Body() data: any) {
    return this.performanceService.updateGoalProgress(+id, req.user.employeeId, data);
  }

  @Delete('goals/:id')
  async deleteGoal(@Req() req, @Param('id') id: string) {
    return this.performanceService.deleteGoal(+id, req.user.employeeId);
  }

  // --- OKRs ---
  @Get('okrs')
  async getCompanyOKRs(@Req() req) {
    return this.performanceService.getCompanyOKRs(req.user.companyId);
  }

  @Post('okrs')
  async createOKR(@Req() req, @Body() data: any) {
    // Only allow creation if the user is HR or has permission. For now assume req.user is authorized if they hit this.
    return this.performanceService.createOKR(req.user.companyId, req.user.employeeId, data);
  }

  @Put('okrs/:id')
  async updateOKR(@Req() req, @Param('id') id: string, @Body() data: any) {
    return this.performanceService.updateOKR(+id, req.user.companyId, data);
  }

  @Delete('okrs/:id')
  async deleteOKR(@Req() req, @Param('id') id: string) {
    return this.performanceService.deleteOKR(+id, req.user.companyId);
  }

  // --- Key Results ---
  @Put('key-results/:id')
  async updateKeyResult(@Param('id') id: string, @Body() data: any) {
    return this.performanceService.updateKeyResult(+id, data);
  }

  // --- Appraisal Cycles ---
  @Get('cycles')
  async getAppraisalCycles(@Req() req) {
    return this.performanceService.getAppraisalCycles(req.user.companyId);
  }

  @Post('cycles')
  async createAppraisalCycle(@Req() req, @Body() data: any) {
    return this.performanceService.createAppraisalCycle(req.user.companyId, data);
  }

  // --- Reviews ---
  @Get('reviews/me')
  async getMyReviews(@Req() req) {
    return this.performanceService.getMyReviews(req.user.employeeId);
  }

  @Get('reviews/team')
  async getTeamReviews(@Req() req) {
    return this.performanceService.getTeamReviews(req.user.employeeId); // manager is the employee
  }

  @Post('reviews')
  async createReview(@Req() req, @Body() data: any) {
    return this.performanceService.createReview(req.user.employeeId, req.user.companyId, data);
  }

  @Put('reviews/:id')
  async updateReview(@Req() req, @Param('id') id: string, @Body() data: any) {
    return this.performanceService.updateReview(+id, req.user.employeeId, data);
  }

  @Put('reviews/:id/self-appraisal')
  async submitSelfAppraisal(@Req() req, @Param('id') id: string, @Body() data: any) {
    return this.performanceService.submitSelfAppraisal(+id, req.user.employeeId, data);
  }

  @Put('reviews/:id/manager-appraisal')
  async submitManagerAppraisal(@Req() req, @Param('id') id: string, @Body() data: any) {
    return this.performanceService.submitManagerAppraisal(+id, req.user.employeeId, data);
  }

  @Put('reviews/:id/signoff')
  async signoffReview(@Req() req, @Param('id') id: string, @Body() data: any) {
    return this.performanceService.signoffReview(+id, req.user.employeeId, data.role, data.action, data.comments);
  }

  @Put('appraisal-date/:employeeId')
  async setNextAppraisalDate(@Param('employeeId') employeeId: string, @Body() data: { date: string }) {
    return this.performanceService.setNextAppraisalDate(+employeeId, data.date);
  }

  // --- Peer Feedback ---
  @Post('peer-feedback/request')
  async requestPeerFeedback(@Req() req, @Body() data: any) {
    return this.performanceService.requestPeerFeedback(req.user.companyId, data);
  }

  @Get('peer-feedback/me')
  async getMyPeerRequests(@Req() req) {
    return this.performanceService.getMyPeerRequests(req.user.employeeId);
  }

  @Get('peer-feedback/employee/:employeeId')
  async getPeerFeedbackForEmployee(@Param('employeeId') employeeId: string, @Query('cycleId') cycleId?: string) {
    return this.performanceService.getPeerFeedbackForEmployee(+employeeId, cycleId ? +cycleId : undefined);
  }

  @Put('peer-feedback/:id/submit')
  async submitPeerFeedback(@Req() req, @Param('id') id: string, @Body() data: any) {
    return this.performanceService.submitPeerFeedback(+id, req.user.employeeId, data);
  }
}
