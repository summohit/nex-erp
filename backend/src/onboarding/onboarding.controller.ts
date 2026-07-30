import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('onboarding')
@UseGuards(AuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('templates')
  async getTemplates(@Request() req) {
    return this.onboardingService.getTemplates(req.user.companyId);
  }

  @Post('templates')
  async addTemplate(@Request() req, @Body() data: { title: string, description?: string }) {
    return this.onboardingService.addTemplate(req.user.companyId, data);
  }

  @Delete('templates/:id')
  async deleteTemplate(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.onboardingService.deleteTemplate(req.user.companyId, id);
  }

  @Get('board')
  async getOnboardingBoard(@Request() req) {
    // Ideally add an RBAC check here to ensure they are HR or ADMIN
    return this.onboardingService.getOnboardingBoard(req.user.companyId);
  }

  @Get('my-tasks')
  async getMyTasks(@Request() req) {
    return this.onboardingService.getMyTasks(req.user.companyId, req.user.sub);
  }

  @Put('my-tasks/:id/complete')
  async completeTask(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.onboardingService.completeTask(req.user.companyId, req.user.sub, id);
  }

  @Put('tasks/:id/toggle')
  async toggleTask(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('isCompleted') isCompleted: boolean) {
    return this.onboardingService.toggleTaskForAdmin(req.user.companyId, id, isCompleted);
  }

  @Put('employee/:id/status')
  async updateEmployeeStatus(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('status') status: string) {
    return this.onboardingService.updateEmployeeStatus(req.user.companyId, id, status);
  }
}
