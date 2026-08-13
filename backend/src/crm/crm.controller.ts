import { Controller, Get, Post, Put, Delete, Body, Param, Request, UseGuards, ParseIntPipe } from '@nestjs/common';
import { CrmService } from './crm.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../auth/permissions/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';

@Controller('crm')
@UseGuards(AuthGuard, PermissionsGuard)
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Post('leads')
  @RequirePermissions({ resourceType: 'crm', action: 'CREATE' })
  createLead(@Request() req, @Body() data: any) {
    return this.crmService.createLead(req.user.companyId, data);
  }

  @Get('leads')
  @RequirePermissions({ resourceType: 'crm', action: 'READ' })
  getLeads(@Request() req) {
    return this.crmService.getLeads(req.user.companyId);
  }

  @Put('leads/:id/status')
  @RequirePermissions({ resourceType: 'crm', action: 'UPDATE' })
  updateLeadStatus(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('status') status: string) {
    return this.crmService.updateLeadStatus(req.user.companyId, id, status);
  }
  
  @Put('leads/:id')
  @RequirePermissions({ resourceType: 'crm', action: 'UPDATE' })
  updateLead(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.crmService.updateLead(req.user.companyId, id, data);
  }

  @Delete('leads/:id')
  @RequirePermissions({ resourceType: 'crm', action: 'DELETE' })
  deleteLead(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.deleteLead(req.user.companyId, id);
  }
}
