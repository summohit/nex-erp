import { Controller, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { CompanyService } from './company.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('company')
@UseGuards(AuthGuard)
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get('profile')
  getProfile(@Request() req) {
    return this.companyService.getCompanyProfile(req.user.companyId);
  }

  @Put('profile')
  updateProfile(
    @Request() req,
    @Body() data: { name?: string, domain?: string, industry?: string, size?: string, timezone?: string, logoUrl?: string }
  ) {
    return this.companyService.updateCompanyProfile(req.user.companyId, data);
  }
}
