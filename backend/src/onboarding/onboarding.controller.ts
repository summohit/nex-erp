import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, ParseIntPipe, ForbiddenException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { AuthGuard } from '../auth/auth.guard';

/** The HR side of onboarding: templates, the board, and moving people along it. */
const ONBOARDING_MANAGERS = ['SUPERADMIN', 'ADMIN', 'HR'];
function requireOnboardingManager(req: any) {
  if (!ONBOARDING_MANAGERS.includes(req.user?.role)) {
    throw new ForbiddenException('Only HR and administrators can manage onboarding.');
  }
}

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
    requireOnboardingManager(req);
    return this.onboardingService.addTemplate(req.user.companyId, data);
  }

  @Delete('templates/:id')
  async deleteTemplate(@Request() req, @Param('id', ParseIntPipe) id: number) {
    requireOnboardingManager(req);
    return this.onboardingService.deleteTemplate(req.user.companyId, id);
  }

  @Get('board')
  async getOnboardingBoard(@Request() req) {
    requireOnboardingManager(req);
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
    requireOnboardingManager(req);
    return this.onboardingService.toggleTaskForAdmin(req.user.companyId, id, isCompleted);
  }

  @Put('employee/:id/status')
  async updateEmployeeStatus(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('status') status: string) {
    requireOnboardingManager(req);
    return this.onboardingService.updateEmployeeStatus(req.user.companyId, id, status);
  }

  // --- Self-service onboarding (13 Nov 2026) ---
  @Get('self')
  async getMySelfOnboarding(@Request() req) {
    return this.onboardingService.getMySelfOnboarding(req.user.companyId, req.user.sub);
  }

  @Post('self/submit')
  async submitMySelfOnboarding(@Request() req) {
    return this.onboardingService.submitMySelfOnboarding(req.user.companyId, req.user.sub);
  }

  @Get('self-reviews')
  async getSelfOnboardingQueue(@Request() req) {
    requireOnboardingManager(req);
    return this.onboardingService.getSelfOnboardingQueue(req.user.companyId);
  }

  @Post('self-reviews/:employeeId')
  async reviewSelfOnboarding(
    @Request() req,
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() body: { decision: 'APPROVE' | 'CHANGES'; notes?: Record<string, string> },
  ) {
    requireOnboardingManager(req);
    return this.onboardingService.reviewSelfOnboarding(req.user.companyId, employeeId, body.decision, body.notes);
  }
}
