import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException, ForbiddenException, ParseIntPipe, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProfileCompletenessService } from './profile-completeness/profile-completeness.service';
import { uploadTypes } from './profile-completeness/document-policy';
import {
  ALL_DOCUMENT_TYPES, OPTIONAL_DOCUMENTS, PREVIOUS_EMPLOYMENT_DOCUMENTS, REQUIRED_DOCUMENTS,
} from './profile-completeness/profile-documents';
import { EmployeesService } from './employees.service';
import { EmployeeActivityService } from './employee-activity.service';
import { EmployeesImportService } from './employees-import.service';
import { AuthGuard } from '../auth/auth.guard';

/**
 * Adding, editing, importing and deactivating employees belongs to the people
 * who run the directory. These routes used to check only that the caller was
 * signed in, so any employee could suspend a colleague or create an account
 * with any role.
 */
const DIRECTORY_MANAGERS = ['SUPERADMIN', 'ADMIN', 'HR'];
function requireDirectoryManager(req: any, role?: string | null) {
  if (!DIRECTORY_MANAGERS.includes(req.user?.role)) {
    throw new ForbiddenException('Only HR and administrators can change employee records.');
  }
  // Only a super admin can make another super admin.
  if (role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
    throw new ForbiddenException('Only a super admin can grant the super admin role.');
  }
}

@Controller('employees')
@UseGuards(AuthGuard)
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly employeesImportService: EmployeesImportService,
    private readonly profileCompleteness: ProfileCompletenessService,
    private readonly activity: EmployeeActivityService,
  ) {}

  @Post('bulk-upload')
  @UseInterceptors(FileInterceptor('file'))
  async bulkUpload(
    @Request() req, 
    @UploadedFile() file: Express.Multer.File,
    @Body('departmentId') departmentId?: string,
    @Body('designationId') designationId?: string,
    @Body('role') role?: string
  ) {
    requireDirectoryManager(req, role);
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }
    if (!file.originalname.endsWith('.csv')) {
      throw new BadRequestException('Only .csv files are supported.');
    }
    return this.employeesImportService.processCsv(
      req.user.companyId, 
      file.buffer,
      departmentId ? parseInt(departmentId, 10) : null,
      designationId ? parseInt(designationId, 10) : null,
      role || null
    );
  }

  @Get()
  findAll(@Request() req) {
    return this.employeesService.findAll(req.user.companyId, req.user.role);
  }

  @Get('basic-list')
  findBasicList(@Request() req) {
    return this.employeesService.findBasicList(req.user.companyId);
  }

  @Post('send-welcome-emails')
  sendWelcomeEmails(@Request() req, @Body('employeeIds') employeeIds: number[]) {
    requireDirectoryManager(req);
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      throw new BadRequestException('employeeIds must be a non-empty array.');
    }
    return this.employeesService.sendWelcomeEmails(req.user.companyId, employeeIds);
  }

  @Get('org-chart')
  getOrgChart(@Request() req) {
    return this.employeesService.getOrgChart(req.user.companyId, req.user.role);
  }

  @Get('ceo')
  getCeo(@Request() req) {
    return this.employeesService.findCeo(req.user.companyId);
  }

  @Post()
  create(@Request() req, @Body() data: any) {
    requireDirectoryManager(req, data?.role);
    return this.employeesService.create(req.user.companyId, data);
  }

  /** Begin the normal ATS offer flow for an existing trainee account. */
  @Post(':id/convert-to-employee')
  convertTrainee(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.employeesService.startTraineeConversion(+id, req.user.companyId, req.user.role, data);
  }

  @Put(':id')
  update(@Request() req, @Param('id') id: string, @Body() data: any) {
    requireDirectoryManager(req, data?.role);
    return this.employeesService.update(+id, req.user.companyId, data);
  }

  /**
   * §23. Separate from PUT :id so a commercial rate cannot ride in alongside
   * an ordinary profile edit; the service re-checks the role regardless.
   */
  @Put(':id/cost-rate')
  setCostRate(@Request() req, @Param('id') id: string, @Body('hourlyCostRate') rate: number | null) {
    return this.employeesService.setCostRate(
      +id,
      req.user.companyId,
      req.user.role,
      rate === null || rate === undefined || (rate as any) === '' ? null : Number(rate),
    );
  }

  @Delete(':id')
  delete(@Request() req, @Param('id') id: string) {
    requireDirectoryManager(req);
    return this.employeesService.delete(+id, req.user.companyId);
  }

  /** Whether the signed-in person has anyone reporting to them (mobile shows My Team only then). */
  @Get('me/team-summary')
  getMyTeamSummary(@Request() req) {
    return this.employeesService.getMyTeamSummary(req.user.companyId, req.user.employeeId ?? null);
  }

  /** Profile reminder: what the signed-in person still has to upload or fill in. */
  @Get('me/profile-completeness')
  getMyProfileCompleteness(@Request() req) {
    return this.profileCompleteness.mine(req.user.companyId, req.user.employeeId ?? null);
  }

  /** "This is my first job": no UAN, experience letter or salary slip asked for. */
  @Put('me/first-job')
  setMyFirstJob(@Request() req, @Body() body: { firstJob: boolean }) {
    return this.profileCompleteness.setFirstJob(req.user.companyId, req.user.employeeId ?? null, !!body?.firstJob);
  }

  /** HR: the document lock (on/off and start date). */
  @Get('profile-completeness/lock')
  getProfileLock(@Request() req) {
    return this.profileCompleteness.getLock(req.user.companyId);
  }

  @Put('profile-completeness/lock')
  setProfileLock(@Request() req, @Body() body: { enabled?: boolean; from?: string | null }) {
    return this.profileCompleteness.setLock(req.user.companyId, req.user.role, body);
  }

  /** HR: who is excused from the document reminder and lock. */
  @Get('profile-completeness/exempt')
  getProfileExempt(@Request() req) {
    return this.profileCompleteness.listExempt(req.user.companyId, req.user.role);
  }

  @Put('profile-completeness/exempt/:employeeId')
  setProfileExempt(@Request() req, @Param('employeeId', ParseIntPipe) employeeId: number, @Body() body: { exempt: boolean }) {
    return this.profileCompleteness.setExempt(req.user.companyId, req.user.role, employeeId, !!body?.exempt);
  }

  /** HR: everyone's profile completion, with what is missing and their manager. */
  @Get('profile-completeness')
  getProfileCompletenessReport(@Request() req) {
    return this.profileCompleteness.report(req.user.companyId, req.user.role);
  }

  /** The document types, in order: one list for every upload dropdown. */
  @Get('document-types')
  async getDocumentTypes(@Request() req) {
    // From HR's document rules (16 Nov 2026); the old keys stay for callers.
    const rules = await this.profileCompleteness.getDocumentPolicy(req.user.companyId);
    const active = rules.filter((r) => r.active);
    return {
      rules,
      required: active.filter((r) => r.required === 'ALL').map((r) => r.type),
      previousEmployment: active.filter((r) => r.required === 'EXPERIENCED').map((r) => r.type),
      optional: [...active.filter((r) => r.required === 'OPTIONAL').map((r) => r.type), 'Other'],
      all: uploadTypes(rules),
    };
  }

  /** HR / Super Admin: replace the document rules (Settings → Document Requirements). */
  @Put('profile-completeness/document-policy')
  saveDocumentPolicy(@Request() req, @Body() body: { rules: unknown }) {
    return this.profileCompleteness.saveDocumentPolicy(req.user.companyId, req.user.role, body?.rules);
  }

  /** Super Admin: document waivers waiting for a decision (16 Nov 2026). */
  @Get('profile-completeness/waivers')
  getPendingWaivers(@Request() req) {
    return this.profileCompleteness.pendingWaivers(req.user.companyId, req.user.role);
  }

  @Put('profile-completeness/waivers/:waiverId')
  decideWaiver(@Request() req, @Param('waiverId', ParseIntPipe) waiverId: number, @Body() body: { action: 'APPROVE' | 'REJECT'; note?: string }) {
    return this.profileCompleteness.decideWaiver(req.user.companyId, req.user.role, req.user.employeeId ?? null, waiverId, body?.action, body?.note);
  }

  @Get(':id/document-waivers')
  getWaivers(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.profileCompleteness.listWaivers(req.user.companyId, id);
  }

  /** HR asks for a waiver; the Super Admin's is approved at once. */
  @Post(':id/document-waivers')
  requestWaiver(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: { documentType: string; reason: string }) {
    return this.profileCompleteness.requestWaiver(req.user.companyId, req.user.role, req.user.employeeId ?? null, id, body?.documentType, body?.reason);
  }

  /** Super Admin / HR: switch someone's login to their office email (16 Nov 2026). */
  @Get(':id/hourly-cost')
  getHourlyCost(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.employeesService.getHourlyCost(req.user.companyId, req.user.role, id);
  }

  @Get(':id/intro-status')
  introStatus(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.employeesService.introStatus(req.user.companyId, req.user.role, id);
  }

  @Post(':id/welcome-email')
  sendWelcome(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: { force?: boolean }) {
    return this.employeesService.sendWelcome(req.user.companyId, req.user.role, req.user.sub ?? null, id, !!body?.force);
  }

  @Post(':id/intro-email')
  sendIntro(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.employeesService.sendIntro(req.user.companyId, req.user.role, req.user.sub ?? null, id, body || {});
  }

  @Post(':id/login-email/resend')
  resendLoginEmailNotice(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.employeesService.resendLoginEmailNotice(req.user.companyId, req.user.role, req.user.sub ?? null, id);
  }

  @Post(':id/login-email')
  changeLoginEmail(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: { email: string }) {
    return this.employeesService.changeLoginEmail(req.user.companyId, req.user.role, req.user.sub ?? null, id, body?.email);
  }

  /** Super Admin: move the shared HR login to another person (16 Nov 2026). */
  @Post(':id/handover-login')
  handoverLogin(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: { toEmployeeId: number }) {
    return this.employeesService.handoverSharedLogin(req.user.companyId, req.user.role, req.user.sub ?? null, id, Number(body?.toEmployeeId));
  }

  @Get('me/profile')
  getMyProfile(@Request() req) {
    return this.employeesService.getMyProfile(req.user.companyId, req.user.sub);
  }

  @Get(':id/profile')
  getProfile(@Request() req, @Param('id') id: string) {
    return this.employeesService.getProfile(+id, req.user.companyId, req.user.sub, req.user.role);
  }

  /** Profile Activity tab (17 Nov 2026): one timeline from existing records. */
  @Get(':id/activity')
  getActivity(@Request() req, @Param('id') id: string, @Query() q: any) {
    return this.activity.getActivity(req.user.companyId, { role: req.user.role, employeeId: req.user.employeeId ?? null }, +id, {
      before: q.before, limit: q.limit ? Number(q.limit) : undefined, areas: q.areas, from: q.from, to: q.to,
    });
  }

  @Get(':id/history')
  getEmploymentHistory(@Request() req, @Param('id') id: string) {
    return this.employeesService.getEmploymentHistory(+id, req.user.companyId, req.user.sub, req.user.role);
  }

  @Put(':id/profile')
  updateProfile(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.employeesService.updateProfile(+id, req.user.companyId, req.user.sub, req.user.role, data);
  }

  @Post(':id/contacts')
  addContact(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.employeesService.addContact(+id, req.user.companyId, req.user.sub, req.user.role, data);
  }

  @Put(':id/contacts/:contactId')
  updateContact(@Request() req, @Param('id') id: string, @Param('contactId') contactId: string, @Body() data: any) {
    return this.employeesService.updateContact(+id, +contactId, req.user.companyId, req.user.sub, req.user.role, data);
  }

  @Delete(':id/contacts/:contactId')
  deleteContact(@Request() req, @Param('id') id: string, @Param('contactId') contactId: string) {
    return this.employeesService.deleteContact(+id, +contactId, req.user.companyId, req.user.sub, req.user.role);
  }

  @Post(':id/documents')
  addDocument(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.employeesService.addDocument(+id, req.user.companyId, req.user.sub, req.user.role, data);
  }

  @Post(':id/documents/bulk')
  addDocuments(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.employeesService.addDocuments(+id, req.user.companyId, req.user.sub, req.user.role, data);
  }

  /** { documentType } — re-file an uploaded document, e.g. one saved as "Other". */
  @Put(':id/documents/:documentId')
  updateDocumentType(@Request() req, @Param('id') id: string, @Param('documentId') documentId: string, @Body() body: { documentType?: string; fileName?: string }) {
    return this.employeesService.updateDocumentType(+id, +documentId, req.user.companyId, req.user.sub, req.user.role, body?.documentType ?? '', body?.fileName);
  }

  @Delete(':id/documents/:documentId')
  deleteDocument(@Request() req, @Param('id') id: string, @Param('documentId') documentId: string) {
    return this.employeesService.deleteDocument(+id, +documentId, req.user.companyId, req.user.sub, req.user.role);
  }

  @Post(':id/skills')
  addSkill(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.employeesService.addSkill(+id, req.user.companyId, req.user.sub, req.user.role, data);
  }

  @Put(':id/skills/:skillId')
  updateSkill(@Request() req, @Param('id') id: string, @Param('skillId') skillId: string, @Body() data: any) {
    return this.employeesService.updateSkill(+id, +skillId, req.user.companyId, req.user.sub, req.user.role, data);
  }

  @Delete(':id/skills/:skillId')
  deleteSkill(@Request() req, @Param('id') id: string, @Param('skillId') skillId: string) {
    return this.employeesService.deleteSkill(+id, +skillId, req.user.companyId, req.user.sub, req.user.role);
  }

  @Post(':id/resume-lines')
  addResumeLine(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.employeesService.addResumeLine(+id, req.user.companyId, req.user.sub, req.user.role, data);
  }

  @Put(':id/resume-lines/:lineId')
  updateResumeLine(@Request() req, @Param('id') id: string, @Param('lineId') lineId: string, @Body() data: any) {
    return this.employeesService.updateResumeLine(+id, +lineId, req.user.companyId, req.user.sub, req.user.role, data);
  }

  @Delete(':id/resume-lines/:lineId')
  deleteResumeLine(@Request() req, @Param('id') id: string, @Param('lineId') lineId: string) {
    return this.employeesService.deleteResumeLine(+id, +lineId, req.user.companyId, req.user.sub, req.user.role);
  }
}
