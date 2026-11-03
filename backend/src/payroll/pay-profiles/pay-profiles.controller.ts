import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { PayProfilesService, assertPayrollEditor, assertPayrollViewer } from './pay-profiles.service';

/** Pay profiles (Payroll plan Phase 2). Finance and admins change them; HR can look. */
@Controller('payroll/pay-profiles')
@UseGuards(AuthGuard)
export class PayProfilesController {
  constructor(private readonly profiles: PayProfilesService) {}

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

  @Get(':employeeId')
  get(@Req() req: any, @Param('employeeId', ParseIntPipe) employeeId: number) {
    assertPayrollViewer(req.user.role);
    return this.profiles.get(req.user.companyId, employeeId);
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
