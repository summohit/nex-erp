import { Controller, Get, Put, Body, Req, UseGuards } from '@nestjs/common';
import { PayrollSettingsService } from './payroll-settings.service';
import { AuthGuard } from '../auth/auth.guard';
import type { Request } from 'express';

@Controller('payroll-settings')
@UseGuards(AuthGuard)
export class PayrollSettingsController {
  constructor(private readonly payrollSettingsService: PayrollSettingsService) {}

  @Get()
  getSettings(@Req() req: Request) {
    const companyId = (req.user as any).companyId;
    return this.payrollSettingsService.getSettings(companyId);
  }

  @Put()
  updateSettings(@Req() req: Request, @Body() data: any) {
    const companyId = (req.user as any).companyId;
    return this.payrollSettingsService.updateSettings(companyId, data);
  }
}
