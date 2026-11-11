import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { isSuperAdmin } from '../../common/company-roles';

/** Salary amounts are changed by the Super Admin only (11 Nov 2026), not Finance or HR. */
export function assertSalaryEditor(role?: string | null): void {
  if (!isSuperAdmin(role)) throw new ForbiddenException('Only the Super Admin can change a salary.');
}
import { AuthGuard } from '../../auth/auth.guard';
import { PayProfilesService, assertPayrollEditor, assertPayrollViewer } from './pay-profiles.service';
import { DocumentReaderService } from './document-reader.service';
import { PayrollCompareService } from './payroll-compare.service';
import { PayrollDryRunService } from './payroll-dry-run.service';

/** Pay profiles (Payroll plan Phase 2). Finance and admins change them; HR can look. */
@Controller('payroll/pay-profiles')
@UseGuards(AuthGuard)
export class PayProfilesController {
  constructor(
    private readonly profiles: PayProfilesService,
    private readonly reader: DocumentReaderService,
    private readonly comparer: PayrollCompareService,
    private readonly dryRun: PayrollDryRunService,
  ) {}

  @Get()
  list(@Req() req: any) {
    assertPayrollViewer(req.user.role);
    return this.profiles.list(req.user.companyId);
  }

  // Before ':employeeId' so "import" isn't read as an id.
  @Get('import/preview')
  previewImport(@Req() req: any) {
    assertPayrollEditor(req.user.role);
    return this.profiles.previewImport(req.user.companyId);
  }

  @Post('import/apply')
  applyImport(@Req() req: any, @Body() body: any) {
    assertSalaryEditor(req.user.role);
    return this.profiles.applyImport(req.user.companyId, body ?? {}, req.user.sub);
  }

  /** Old monthly run vs the engine for a month, per employee. Read-only. */
  @Get('compare')
  compare(@Req() req: any, @Query('month') month: string, @Query('year') year: string) {
    assertPayrollViewer(req.user.role);
    return this.comparer.compare(req.user.companyId, Number(month), Number(year));
  }

  /** Payslips for a month on the new engine, with loss of pay. Read-only — nothing is saved. */
  @Get('dry-run')
  runDry(@Req() req: any, @Query('month') month: string, @Query('year') year: string, @Query('fullMonth') fullMonth?: string, @Query('currentProfiles') currentProfiles?: string) {
    assertPayrollViewer(req.user.role);
    const on = (v?: string) => v === '1' || v === 'true';
    return this.dryRun.run(req.user.companyId, Number(month), Number(year), on(fullMonth), on(currentProfiles));
  }

  /** Send uploaded PAN / UAN / bank documents to Gemini; results are suggestions only. */
  @Post('read-documents')
  readDocuments(@Req() req: any, @Body() body: any) {
    assertPayrollEditor(req.user.role);
    const ids = Array.isArray(body?.employeeIds) ? body.employeeIds.map(Number).filter((n: number) => n > 0) : undefined;
    return this.reader.start(req.user.companyId, ids);
  }

  @Get('read-documents/status')
  readStatus(@Req() req: any) {
    assertPayrollViewer(req.user.role);
    return this.reader.status(req.user.companyId);
  }

  @Post('suggestions/:id/reject')
  rejectSuggestion(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    assertPayrollEditor(req.user.role);
    return this.profiles.rejectSuggestion(req.user.companyId, id, req.user.sub);
  }

  @Get(':employeeId')
  get(@Req() req: any, @Param('employeeId', ParseIntPipe) employeeId: number) {
    assertPayrollViewer(req.user.role);
    return this.profiles.get(req.user.companyId, employeeId);
  }

  @Post(':employeeId/verify')
  verify(@Req() req: any, @Param('employeeId', ParseIntPipe) employeeId: number, @Body() body: any) {
    assertPayrollEditor(req.user.role);
    return this.profiles.verifyDetail(req.user.companyId, employeeId, body ?? {}, req.user.sub);
  }

  @Put(':employeeId/details')
  updateDetails(@Req() req: any, @Param('employeeId', ParseIntPipe) employeeId: number, @Body() body: any) {
    assertPayrollEditor(req.user.role);
    return this.profiles.updateDetails(req.user.companyId, employeeId, body ?? {}, req.user.sub);
  }

  @Post(':employeeId/versions')
  addVersion(@Req() req: any, @Param('employeeId', ParseIntPipe) employeeId: number, @Body() body: any) {
    assertSalaryEditor(req.user.role);
    return this.profiles.addVersion(req.user.companyId, employeeId, body ?? {}, req.user.sub);
  }
}
