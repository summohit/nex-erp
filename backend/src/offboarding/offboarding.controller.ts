import { Controller, Get, Post, Put, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { OffboardingService } from './offboarding.service';
import { AuthGuard } from '../auth/auth.guard';

@UseGuards(AuthGuard)
@Controller('offboarding')
export class OffboardingController {
  constructor(private readonly offboardingService: OffboardingService) {}

  @Get('resignations')
  async getResignations(@Request() req) {
    const { companyId, role } = req.user;
    const employeeId = req.user.employeeId;
    return this.offboardingService.getResignations(companyId, role, employeeId);
  }

  @Post('resign')
  async submitResignation(@Request() req, @Body() body: { reason: string, intendedLastWorkingDay: string }) {
    if (!req.user.employeeId) throw new ForbiddenException('Only employees can submit resignations');
    
    return this.offboardingService.submitResignation(
      req.user.companyId,
      req.user.employeeId,
      {
        reason: body.reason,
        intendedLastWorkingDay: new Date(body.intendedLastWorkingDay)
      }
    );
  }

  @Put('resignations/:id/status')
  async updateResignationStatus(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { status: string, approvedLastWorkingDay?: string, remarks?: string }
  ) {
    const isAdmin = ['SUPERADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(req.user.role);
    if (!isAdmin) throw new ForbiddenException('Not authorized to approve resignations');

    return this.offboardingService.updateResignationStatus(
      req.user.companyId,
      parseInt(id),
      req.user.userId,
      body.status,
      body.approvedLastWorkingDay ? new Date(body.approvedLastWorkingDay) : undefined,
      body.remarks
    );
  }

  @Get('tasks')
  async getTasks(@Request() req) {
    return this.offboardingService.getTasks(req.user.companyId);
  }

  @Put('tasks/:id/complete')
  async clearTask(@Request() req, @Param('id') id: string, @Body() body: { remarks?: string }) {
    const isAuthorized = ['SUPERADMIN', 'ADMIN', 'HR', 'FINANCE'].includes(req.user.role);
    if (!isAuthorized) throw new ForbiddenException('Not authorized to clear tasks');

    return this.offboardingService.clearTask(parseInt(id), req.user.companyId, req.user.userId, body.remarks);
  }

  @Post('exit-interview')
  async submitExitInterview(
    @Request() req,
    @Body() body: { employeeId: number, feedback: string, rating: number }
  ) {
    const isAuthorized = ['SUPERADMIN', 'ADMIN', 'HR'].includes(req.user.role);
    if (!isAuthorized) throw new ForbiddenException('Only HR/Admin can submit exit interviews');

    return this.offboardingService.submitExitInterview(
      req.user.companyId,
      body.employeeId,
      { feedback: body.feedback, rating: body.rating },
      req.user.userId
    );
  }

  @Get('exit-interviews')
  async getExitInterviews(@Request() req) {
    const isAuthorized = ['SUPERADMIN', 'ADMIN', 'HR'].includes(req.user.role);
    if (!isAuthorized) throw new ForbiddenException('Not authorized to view exit interviews');

    return this.offboardingService.getExitInterviews(req.user.companyId);
  }
}
