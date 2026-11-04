import { Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, Request, Query, ParseIntPipe } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { OfferLettersService } from './offer-letters.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

/**
 * Candidates, offers and salary approvals are HR / admin work: every route
 * needs the recruitment/candidates permission, as the Candidates page does.
 * Interviewers (any role with recruitment/interviews) keep their own list and
 * may record feedback on interviews assigned to them. Until now every route
 * here was open to any signed-in employee.
 */
@Controller('recruitment/applications')
@UseGuards(AuthGuard, PermissionsGuard)
@Permissions('recruitment/candidates')
export class ApplicationsController {
  constructor(
    private readonly applicationsService: ApplicationsService,
    private readonly offerLettersService: OfferLettersService,
  ) {}

  @Get()
  findAll(@Request() req, @Query('jobId') jobId?: string) {
    const parsedJobId = jobId ? parseInt(jobId, 10) : undefined;
    return this.applicationsService.findAll(req.user.companyId, parsedJobId);
  }

  // --- Static Endpoints ---

  @Get('offer-letters')
  getOfferLetters(@Request() req) {
    return this.offerLettersService.listIssued(req.user.companyId);
  }

  @Get('my-interviews')
  @Permissions('recruitment/candidates', 'recruitment/interviews')
  getMyInterviews(@Request() req) {
    return this.applicationsService.getMyInterviews(req.user.companyId, req.user.sub, req.user.role);
  }

  @Get('pending-approvals')
  getPendingApprovals(@Request() req) {
    return this.applicationsService.findPendingApprovals(req.user.companyId);
  }

  @Get('analytics/dashboard')
  getAnalytics(@Request() req) {
    return this.applicationsService.getAnalytics(req.user.companyId);
  }

  @Get('analytics/hiring-reports')
  getHiringReports(@Request() req) {
    return this.applicationsService.getHiringReports(req.user.companyId);
  }

  @Put('interviews/:interviewId')
  @Permissions('recruitment/candidates', 'recruitment/interviews')
  updateInterview(@Request() req, @Param('interviewId', ParseIntPipe) interviewId: number, @Body() body: any) {
    return this.applicationsService.updateInterview(interviewId, req.user.companyId, body, { userId: req.user.sub, role: req.user.role });
  }

  @Delete('interviews/:interviewId')
  deleteInterview(@Request() req, @Param('interviewId', ParseIntPipe) interviewId: number) {
    return this.applicationsService.deleteInterview(interviewId, req.user.companyId);
  }

  // --- Dynamic Application Endpoints (:id) ---

  @Get(':id/follow-ups')
  getFollowUps(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.getFollowUps(id, req.user.companyId);
  }

  @Post(':id/follow-ups')
  createFollowUp(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.applicationsService.createFollowUp(id, req.user.companyId, body);
  }

  @Put(':id/follow-ups/:followUpId')
  updateFollowUp(@Request() req, @Param('id', ParseIntPipe) id: number, @Param('followUpId', ParseIntPipe) followUpId: number, @Body() body: any) {
    return this.applicationsService.updateFollowUp(id, followUpId, req.user.companyId, body);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.findOne(id, req.user.companyId);
  }

  @Put(':id/status')
  updateStatus(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
    @Body('offeredSalary') offeredSalary?: number,
    @Body('rejectionReason') rejectionReason?: string,
    @Body('joiningDate') joiningDate?: string,
    @Body('address') address?: string,
    @Body('approvalReason') approvalReason?: string
  ) {
    return this.applicationsService.updateStatus(
      id, req.user.companyId, status, offeredSalary, rejectionReason, joiningDate, address,
      req.user.sub, approvalReason, req.user.role,
    );
  }

  @Put(':id/profile-budget')
  setProfileBudget(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body('profileBudget') profileBudget?: number | null,
  ) {
    const parsed =
      profileBudget === null || profileBudget === undefined || (profileBudget as any) === ''
        ? null
        : Number(profileBudget);
    return this.applicationsService.setProfileBudget(id, req.user.companyId, parsed);
  }

  @Post(':id/approve-salary')
  approveSalary(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.approveSalary(id, req.user.companyId, req.user.sub);
  }

  @Post(':id/reject-salary')
  rejectSalary(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.rejectSalary(id, req.user.companyId, req.user.sub);
  }

  @Post(':id/onboard')
  onboardCandidate(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.onboardCandidate(id, req.user.companyId, req.user.sub);
  }

  @Get(':id/annexure')
  getAnnexure(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.generateAnnexure(id, req.user.companyId);
  }

  @Put(':id/annexure')
  saveAnnexure(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.applicationsService.saveAnnexure(id, req.user.companyId, body);
  }

  /** Fill the annexure from a payroll salary group (same engine as payslips). */
  @Post(':id/annexure/from-group')
  annexureFromGroup(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('groupCode') groupCode: string, @Body('taxRegime') taxRegime?: string) {
    return this.applicationsService.annexureFromSalaryGroup(id, req.user.companyId, groupCode, taxRegime);
  }

  /** Whether newly generated offer letters include the salary annexure table. */
  @Patch(':id/offer-options')
  setOfferOptions(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('includeSalaryAnnexure') include: boolean) {
    return this.applicationsService.setIncludeSalaryAnnexure(id, req.user.companyId, include === true);
  }

  /** Discard a candidate's customised CTC structure. */
  @Delete(':id/annexure')
  resetAnnexure(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.resetAnnexure(id, req.user.companyId);
  }

  @Get(':id/offer-letter')
  getOfferLetter(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.offerLettersService.getForApplication(id, req.user.companyId);
  }

  @Post(':id/offer-letter')
  generateOfferLetter(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.offerLettersService.generate(id, req.user.companyId);
  }

  /** The letter body for the editor — this candidate's, or the template's. */
  @Get(':id/offer-letter/draft')
  getOfferLetterDraft(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.offerLettersService.getDraft(id, req.user.companyId);
  }

  @Put(':id/offer-letter/draft')
  saveOfferLetterDraft(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body('body') body: string,
  ) {
    return this.offerLettersService.saveDraft(id, req.user.companyId, body);
  }

  /** Discard this candidate's edits and go back to the shared template. */
  @Delete(':id/offer-letter/draft')
  resetOfferLetterDraft(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.offerLettersService.resetDraft(id, req.user.companyId);
  }

  @Post(':id/offer-letter/send')
  sendOfferLetter(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.offerLettersService.sendToCandidate(id, req.user.companyId, req.user.sub);
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
