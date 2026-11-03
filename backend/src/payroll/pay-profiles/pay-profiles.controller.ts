import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { PayProfilesService, assertPayrollEditor, assertPayrollViewer } from './pay-profiles.service';
import { DocumentReaderService } from './document-reader.service';

/** Pay profiles (Payroll plan Phase 2). Finance and admins change them; HR can look. */
@Controller('payroll/pay-profiles')
@UseGuards(AuthGuard)
export class PayProfilesController {
  constructor(
    private readonly profiles: PayProfilesService,
    private readonly reader: DocumentReaderService,
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
    assertPayrollEditor(req.user.role);
    return this.profiles.applyImport(req.user.companyId, body ?? {}, req.user.sub);
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
    assertPayrollEditor(req.user.role);
    return this.profiles.addVersion(req.user.companyId, employeeId, body ?? {}, req.user.sub);
  }
}
