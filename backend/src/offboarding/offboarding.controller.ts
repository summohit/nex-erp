import { Controller, Get, Post, Put, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { OffboardingService } from './offboarding.service';
import { AuthGuard } from '../auth/auth.guard';

@UseGuards(AuthGuard)
@Controller('offboarding')
export class OffboardingController {
  constructor(private readonly offboardingService: OffboardingService) {}

  @Get('handover-reminders')
  myHandoverReminders(@Request() req) { return this.offboardingService.myHandoverReminders(req.user.companyId, req.user.employeeId); }

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
    // 20 Nov 2026: a pending exit goes through Manager → HR → Super Admin; the
    // old one-click approve/reject is routed into that chain.
    if (['APPROVED', 'REJECTED'].includes(String(body.status))) {
      const r = await this.offboardingService.findResignation(req.user.companyId, parseInt(id));
      if (r?.status === 'PENDING') {
        return this.offboardingService.decideExit(req.user.companyId, parseInt(id), { userId: req.user.sub, role: req.user.role, employeeId: req.user.employeeId }, {
          decision: body.status === 'APPROVED' ? 'APPROVE' : 'REJECT', note: body.remarks, lastWorkingDay: body.approvedLastWorkingDay,
        });
      }
    }

    return this.offboardingService.updateResignationStatus(
      req.user.companyId,
      parseInt(id),
      req.user.sub,
      body.status,
      body.approvedLastWorkingDay ? new Date(body.approvedLastWorkingDay) : undefined,
      body.remarks,
      { role: req.user.role, employeeId: req.user.employeeId },
    );
  }

  // ── Offboarding part 4: Full & Final (20 Nov 2026) ──
  @Get('fnf')
  listFnf(@Request() req) { return this.offboardingService.listFnf(req.user.companyId, req.user.role); }

  @Get('resignations/:id/fnf')
  getFnf(@Request() req, @Param('id') id: string) { return this.offboardingService.getFnf(req.user.companyId, req.user.role, +id); }

  @Post('resignations/:id/fnf/prepare')
  prepareFnf(@Request() req, @Param('id') id: string) { return this.offboardingService.prepareFnf(req.user.companyId, { userId: req.user.sub, role: req.user.role }, +id); }

  @Put('fnf/:id')
  saveFnf(@Request() req, @Param('id') id: string, @Body() body: any) { return this.offboardingService.saveFnf(req.user.companyId, { userId: req.user.sub, role: req.user.role }, +id, body); }

  @Post('fnf/:id/:action')
  fnfAction(@Request() req, @Param('id') id: string, @Param('action') action: string, @Body() body: any) {
    const a = ({ submit: 'SUBMIT', approve: 'APPROVE', reject: 'REJECT', paid: 'PAID' } as any)[action];
    if (!a) throw new ForbiddenException('Unknown action');
    return this.offboardingService.fnfAction(req.user.companyId, { userId: req.user.sub, role: req.user.role }, +id, a, body || {});
  }

  // ── Offboarding part 1 (20 Nov 2026) ──
  @Get('notice-policy')
  getNoticePolicy(@Request() req) { return this.offboardingService.getNoticePolicy(req.user.companyId); }

  @Put('notice-policy')
  saveNoticePolicy(@Request() req, @Body() body: any) { return this.offboardingService.saveNoticePolicy(req.user.companyId, req.user.role, body); }

  /** Notice for one person (the resign form shows it; HR uses it when starting an exit). */
  @Get('notice/:employeeId')
  async noticeFor(@Request() req, @Param('employeeId') employeeId: string) {
    const id = Number(employeeId);
    const self = req.user.employeeId === id;
    if (!self && !['SUPERADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(req.user.role)) throw new ForbiddenException('Not allowed.');
    return this.offboardingService.noticeFor(req.user.companyId, id);
  }

  @Post('initiate')
  initiateExit(@Request() req, @Body() body: any) {
    return this.offboardingService.initiateExit(req.user.companyId, { userId: req.user.sub, role: req.user.role }, body);
  }

  @Post('resignations/:id/withdraw')
  withdrawOwn(@Request() req, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.offboardingService.withdrawOwn(req.user.companyId, parseInt(id), { userId: req.user.sub, employeeId: req.user.employeeId }, body?.note);
  }

  @Put('resignations/:id/decision')
  decideExit(@Request() req, @Param('id') id: string, @Body() body: any) {
    return this.offboardingService.decideExit(req.user.companyId, parseInt(id), { userId: req.user.sub, role: req.user.role, employeeId: req.user.employeeId }, body);
  }

  // ── Offboarding part 2 (20 Nov 2026): handover form ──
  @Get('resignations/:id/handover')
  getHandover(@Request() req, @Param('id') id: string) {
    return this.offboardingService.getHandover(req.user.companyId, parseInt(id), { role: req.user.role, employeeId: req.user.employeeId });
  }

  @Put('resignations/:id/handover')
  saveHandover(@Request() req, @Param('id') id: string, @Body() body: { form: any; submit?: boolean }) {
    return this.offboardingService.saveHandover(req.user.companyId, parseInt(id), { userId: req.user.sub, role: req.user.role, employeeId: req.user.employeeId }, body?.form, !!body?.submit);
  }

  @Post('resignations/:id/handover/receive')
  receiveHandover(@Request() req, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.offboardingService.receiveHandover(req.user.companyId, parseInt(id), { userId: req.user.sub, role: req.user.role, employeeId: req.user.employeeId }, body?.note);
  }

  // ── Offboarding part 3 ──
  @Post('resignations/:id/clearance')
  verifyClearance(@Request() req, @Param('id') id: string, @Body() body: any) {
    return this.offboardingService.verifyClearance(req.user.companyId, parseInt(id), { userId: req.user.sub, role: req.user.role }, body || {});
  }

  @Get('resignations/:id/exit-letter')
  getExitLetter(@Request() req, @Param('id') id: string) { return this.offboardingService.getExitLetter(req.user.companyId, req.user.role, parseInt(id)); }

  @Post('resignations/:id/exit-letter/send')
  sendExitLetter(@Request() req, @Param('id') id: string, @Body() body: any) { return this.offboardingService.sendExitLetter(req.user.companyId, { userId: req.user.sub, role: req.user.role }, parseInt(id), body || {}); }

  @Put('resignations/:id/reportees')
  setReportees(@Request() req, @Param('id') id: string, @Body() body: { managerId: number | null; lastWorkingDay?: string; fnfDueDate?: string }) {
    return this.offboardingService.setReporteesTo(req.user.companyId, parseInt(id), req.user.role, body?.managerId ? Number(body.managerId) : null, { lastWorkingDay: body?.lastWorkingDay, fnfDueDate: body?.fnfDueDate, actorUserId: req.user.sub });
  }

  /** HR can separate before the nightly job (e.g. absconding). */
  @Post('resignations/:id/separate')
  separateNow(@Request() req, @Param('id') id: string) {
    if (!['SUPERADMIN', 'ADMIN', 'HR'].includes(req.user.role)) throw new ForbiddenException('Only HR can do this.');
    return this.offboardingService.separate(req.user.companyId, parseInt(id), req.user.sub);
  }

  @Get('tasks')
  async getTasks(@Request() req) {
    // Same people who clear the tasks; the list names every leaver.
    if (!['SUPERADMIN', 'ADMIN', 'HR', 'FINANCE'].includes(req.user.role)) {
      throw new ForbiddenException('Not authorized to view clearance tasks');
    }
    return this.offboardingService.getTasks(req.user.companyId);
  }

  @Put('tasks/:id/complete')
  async clearTask(@Request() req, @Param('id') id: string, @Body() body: { remarks?: string; recoveryAmount?: number }) {
    const isAuthorized = ['SUPERADMIN', 'ADMIN', 'HR', 'FINANCE'].includes(req.user.role);
    if (!isAuthorized) throw new ForbiddenException('Not authorized to clear tasks');

    return this.offboardingService.clearTask(parseInt(id), req.user.companyId, req.user.sub, body.remarks, body.recoveryAmount);
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
      req.user.sub
    );
  }

  @Get('exit-interviews')
  async getExitInterviews(@Request() req) {
    const isAuthorized = ['SUPERADMIN', 'ADMIN', 'HR'].includes(req.user.role);
    if (!isAuthorized) throw new ForbiddenException('Not authorized to view exit interviews');

    return this.offboardingService.getExitInterviews(req.user.companyId);
  }
}
