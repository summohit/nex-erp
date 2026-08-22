import { Controller, Get, Post, Put, Delete, Body, Param, Request, UseGuards, ParseIntPipe } from '@nestjs/common';
import { CrmService } from './crm.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('crm')
@UseGuards(AuthGuard, PermissionsGuard)
@Permissions('crm/leads')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Post('leads')
  createLead(@Request() req, @Body() data: any) {
    return this.crmService.createLead(req.user.companyId, data);
  }

  @Get('leads')
  getLeads(@Request() req) {
    return this.crmService.getLeads(req.user.companyId);
  }

  @Put('leads/:id/status')
  updateLeadStatus(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('status') status: string) {
    return this.crmService.updateLeadStatus(req.user.companyId, id, status);
  }

  @Put('leads/:id')
  updateLead(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.crmService.updateLead(req.user.companyId, id, data);
  }

  @Delete('leads/:id')
  deleteLead(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.deleteLead(req.user.companyId, id);
  }
}
