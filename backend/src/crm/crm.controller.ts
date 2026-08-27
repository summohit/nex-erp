import { Controller, Get, Post, Put, Delete, Body, Param, Request, Query, UseGuards, ParseIntPipe, ForbiddenException } from '@nestjs/common';
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
    if (data.addedById !== undefined) data.addedById = data.addedById ? parseInt(data.addedById, 10) : null;
    if (data.assignedToId !== undefined) data.assignedToId = data.assignedToId ? parseInt(data.assignedToId, 10) : null;
    if (data.broughtByContactId !== undefined) data.broughtByContactId = data.broughtByContactId ? parseInt(data.broughtByContactId, 10) : null;
    return this.crmService.createLead(req.user.companyId, data, req.user.employeeId);
  }

  @Get('leads')
  getLeads(@Request() req) {
    return this.crmService.getLeads(req.user.companyId, req.user);
  }

  @Get('leads/dashboard')
  getLeadsAnalyticsDashboard(@Request() req, @Query() query: any) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Only admins can view the leads analytics dashboard.');
    }
    return this.crmService.getLeadsAnalyticsDashboard(req.user.companyId, query);
  }

  @Put('leads/:id/status')
  updateLeadStatus(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('status') status: string) {
    return this.crmService.updateLeadStatus(req.user.companyId, id, status);
  }

  @Put('leads/:id')
  updateLead(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    if (data.addedById !== undefined) data.addedById = data.addedById ? parseInt(data.addedById, 10) : null;
    if (data.assignedToId !== undefined) data.assignedToId = data.assignedToId ? parseInt(data.assignedToId, 10) : null;
    if (data.broughtByContactId !== undefined) data.broughtByContactId = data.broughtByContactId ? parseInt(data.broughtByContactId, 10) : null;
    return this.crmService.updateLead(req.user.companyId, id, data);
  }

  @Delete('leads/:id')
  deleteLead(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.deleteLead(req.user.companyId, id);
  }

  // ═══════════════════════════════════════════
  // FOLLOW-UP ENDPOINTS
  // ═══════════════════════════════════════════

  @Get('leads/:id/follow-ups')
  getFollowUps(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.getFollowUps(req.user.companyId, id);
  }

  @Post('leads/:id/follow-ups')
  createFollowUp(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.crmService.createFollowUp(req.user.companyId, id, data);
  }

  @Put('leads/:id/follow-ups/:followUpId')
  updateFollowUp(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('followUpId', ParseIntPipe) followUpId: number,
    @Body() data: any
  ) {
    return this.crmService.updateFollowUp(req.user.companyId, id, followUpId, data);
  }

  @Delete('leads/:id/follow-ups/:followUpId')
  deleteFollowUp(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('followUpId', ParseIntPipe) followUpId: number
  ) {
    return this.crmService.deleteFollowUp(req.user.companyId, id, followUpId);
  }
  @Get('follow-ups/stats')
  getFollowUpStats(@Request() req) {
    return this.crmService.getFollowUpStats(req.user.companyId, req.user);
  }

  @Get('follow-ups')
  getAllFollowUps(@Request() req, @Query() query: any) {
    return this.crmService.getAllCompanyFollowUps(req.user.companyId, query, req.user);
  }

  // ═══════════════════════════════════════════
  // LEAD CONTACT ENDPOINTS
  // ═══════════════════════════════════════════

  @Get('lead-contacts')
  getLeadContacts(@Request() req) {
    return this.crmService.getLeadContacts(req.user.companyId);
  }

  @Post('lead-contacts')
  createLeadContact(@Request() req, @Body() data: any) {
    if (data.addedById) data.addedById = parseInt(data.addedById, 10);
    return this.crmService.createLeadContact(req.user.companyId, req.user.sub, data);
  }

  @Put('lead-contacts/:id')
  updateLeadContact(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    if (data.addedById) data.addedById = parseInt(data.addedById, 10);
    return this.crmService.updateLeadContact(req.user.companyId, id, data);
  }

  @Delete('lead-contacts/:id')
  deleteLeadContact(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.deleteLeadContact(req.user.companyId, id);
  }
}
