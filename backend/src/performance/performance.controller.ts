import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
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

  @Delete('goals/:id')
  async deleteGoal(@Req() req, @Param('id') id: string) {
    return this.performanceService.deleteGoal(+id, req.user.employeeId);
  }

  // --- Reviews ---
  @Get('reviews/me')
  async getMyReviews(@Req() req) {
    return this.performanceService.getMyReviews(req.user.employeeId);
  }

  @Get('reviews/team')
  async getTeamReviews(@Req() req) {
    return this.performanceService.getTeamReviews(req.user.employeeId);
  }

  @Post('reviews')
  async createReview(@Req() req, @Body() data: any) {
    return this.performanceService.createReview(req.user.employeeId, req.user.companyId, data);
  }

  @Put('reviews/:id')
  async updateReview(@Req() req, @Param('id') id: string, @Body() data: any) {
    return this.performanceService.updateReview(+id, req.user.employeeId, data);
  }

  @Put('appraisal-date/:employeeId')
  async setNextAppraisalDate(@Param('employeeId') employeeId: string, @Body() data: { date: string }) {
    return this.performanceService.setNextAppraisalDate(+employeeId, data.date);
  }
}
