import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { PayrollMastersService } from './payroll-masters.service';
import { assertPayrollEditor, assertPayrollViewer } from '../pay-profiles/pay-profiles.service';
import type { Request } from 'express';

@Controller('payroll/masters')
@UseGuards(AuthGuard)
export class PayrollMastersController {
  constructor(private readonly mastersService: PayrollMastersService) {}

  // ═══════════════════════════════════════════
  // 1. COMPONENTS (W1, W2)
  // ═══════════════════════════════════════════

  @Get('components')
  getComponents(@Req() req: Request) {
    assertPayrollViewer((req.user as any).role);
    const companyId = (req.user as any).companyId;
    return this.mastersService.getComponents(companyId);
  }

  @Get('components/:code')
  getComponentByCode(@Req() req: Request, @Param('code') code: string) {
    assertPayrollViewer((req.user as any).role);
    const companyId = (req.user as any).companyId;
    return this.mastersService.getComponentByCode(companyId, code);
  }

  @Post('components')
  createComponent(@Req() req: Request, @Body() body: any) {
    assertPayrollEditor((req.user as any).role);
    const companyId = (req.user as any).companyId;
    const userId = (req.user as any).sub;
    return this.mastersService.createComponent(companyId, body, userId);
  }

  @Put('components/:id')
  updateComponent(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    assertPayrollEditor((req.user as any).role);
    const companyId = (req.user as any).companyId;
    const userId = (req.user as any).sub;
    return this.mastersService.updateComponent(companyId, id, body, userId);
  }

  @Delete('components/:id')
  deleteComponent(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    assertPayrollEditor((req.user as any).role);
    const companyId = (req.user as any).companyId;
    const userId = (req.user as any).sub;
    return this.mastersService.deleteComponent(companyId, id, userId);
  }

  // ═══════════════════════════════════════════
  // 2. SALARY GROUPS (W3)
  // ═══════════════════════════════════════════

  @Get('groups')
  getSalaryGroups(
    @Req() req: Request,
    @Query('includeRetired') includeRetired?: string,
  ) {
    assertPayrollViewer((req.user as any).role);
    const companyId = (req.user as any).companyId;
    return this.mastersService.getSalaryGroups(companyId, includeRetired === 'true');
  }

  @Get('groups/:id')
  getSalaryGroupById(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    assertPayrollViewer((req.user as any).role);
    const companyId = (req.user as any).companyId;
    return this.mastersService.getSalaryGroupById(companyId, id);
  }

  @Post('groups')
  saveSalaryGroup(@Req() req: Request, @Body() body: any) {
    assertPayrollEditor((req.user as any).role);
    const companyId = (req.user as any).companyId;
    const userId = (req.user as any).sub;
    return this.mastersService.saveSalaryGroupVersion(companyId, body, userId);
  }

  // ═══════════════════════════════════════════
  // 3. STATUTORY RATES (W5)
  // ═══════════════════════════════════════════

  @Get('statutory-rates')
  getStatutoryRates(@Req() req: Request) {
    assertPayrollViewer((req.user as any).role);
    const companyId = (req.user as any).companyId;
    return this.mastersService.getStatutoryRates(companyId);
  }

  @Post('statutory-rates')
  saveStatutoryRate(@Req() req: Request, @Body() body: any) {
    assertPayrollEditor((req.user as any).role);
    const companyId = (req.user as any).companyId;
    const userId = (req.user as any).sub;
    return this.mastersService.saveStatutoryRate(companyId, body, userId);
  }

  @Put('statutory-rates/:id')
  updateStatutoryRate(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    assertPayrollEditor((req.user as any).role);
    const companyId = (req.user as any).companyId;
    const userId = (req.user as any).sub;
    return this.mastersService.updateStatutoryRate(companyId, id, body, userId);
  }

  // ═══════════════════════════════════════════
  // 4. TAX REGIMES (W4)
  // ═══════════════════════════════════════════

  @Get('tax-regimes')
  getTaxRegimes(
    @Req() req: Request,
    @Query('financialYear') financialYear = '2026-27',
  ) {
    assertPayrollViewer((req.user as any).role);
    const companyId = (req.user as any).companyId;
    return this.mastersService.getTaxRegimes(companyId, financialYear);
  }

  @Put('tax-regimes/:id')
  updateTaxRegime(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    assertPayrollEditor((req.user as any).role);
    const companyId = (req.user as any).companyId;
    const userId = (req.user as any).sub;
    return this.mastersService.updateTaxRegime(companyId, id, body, userId);
  }

  // ═══════════════════════════════════════════
  // 5. CALCULATION & FORMULA TESTING (W2, W7)
  // ═══════════════════════════════════════════

  @Post('validate-formula')
  validateFormula(@Req() req: Request, @Body('formula') formula: string) {
    assertPayrollViewer((req.user as any).role);
    const companyId = (req.user as any).companyId;
    return this.mastersService.validateFormula(companyId, formula);
  }

  @Post('calculate')
  calculateSalary(@Req() req: Request, @Body() body: any) {
    assertPayrollViewer((req.user as any).role);
    const companyId = (req.user as any).companyId;
    return this.mastersService.calculateSalary(companyId, body);
  }

  // ═══════════════════════════════════════════
  // 6. AUDIT LOG (W13)
  // ═══════════════════════════════════════════

  @Get('audit-log')
  getAuditLog(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
  ) {
    assertPayrollViewer((req.user as any).role);
    const companyId = (req.user as any).companyId;
    return this.mastersService.getAuditLog(
      companyId,
      limit ? parseInt(limit, 10) : 100,
      entity || undefined,
      entityId ? parseInt(entityId, 10) : undefined,
    );
  }

  // ═══════════════════════════════════════════
  // 7. YEAR SETTINGS, COMPANY CONFIG, DROPDOWNS (Phase 1)
  // ═══════════════════════════════════════════

  @Get('formula-help')
  getFormulaHelp(@Req() req: Request) {
    assertPayrollViewer((req.user as any).role);
    return this.mastersService.getFormulaHelp((req.user as any).companyId);
  }

  @Get('year-settings')
  getYearSetting(@Req() req: Request, @Query('financialYear') financialYear = '2026-27') {
    assertPayrollViewer((req.user as any).role);
    return this.mastersService.getYearSetting((req.user as any).companyId, financialYear);
  }

  @Put('year-settings')
  saveYearSetting(@Req() req: Request, @Query('financialYear') financialYear = '2026-27', @Body() body: any) {
    assertPayrollEditor((req.user as any).role);
    return this.mastersService.saveYearSetting((req.user as any).companyId, financialYear, body ?? {}, (req.user as any).sub);
  }

  @Get('config')
  getCompanyConfig(@Req() req: Request) {
    assertPayrollViewer((req.user as any).role);
    return this.mastersService.getCompanyConfig((req.user as any).companyId);
  }

  @Put('config')
  saveCompanyConfig(@Req() req: Request, @Body() body: any) {
    assertPayrollEditor((req.user as any).role);
    return this.mastersService.saveCompanyConfig((req.user as any).companyId, body ?? {}, (req.user as any).sub);
  }

  @Get('dropdowns')
  getDropdowns(@Req() req: Request) {
    assertPayrollViewer((req.user as any).role);
    return this.mastersService.getDropdowns((req.user as any).companyId);
  }

  @Put('dropdowns/:listKey')
  saveDropdown(@Req() req: Request, @Param('listKey') listKey: string, @Body('options') options: any[]) {
    assertPayrollEditor((req.user as any).role);
    return this.mastersService.saveDropdown((req.user as any).companyId, listKey, options, (req.user as any).sub);
  }
}
