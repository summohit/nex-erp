import { Controller, Get, Post, Put, Delete, Patch, Body, Param, Request, ParseIntPipe } from '@nestjs/common';
import { LeadFormsService } from './lead-forms.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';

@Controller('crm/lead-forms')
@UseGuards(AuthGuard, PermissionsGuard)
@Permissions('crm/leads')
export class LeadFormsController {
  constructor(private readonly service: LeadFormsService) {}

  @Get()
  list(@Request() req) {
    return this.service.listForms(req.user.companyId);
  }

  @Get('sources')
  sources() {
    return this.service.getAvailableSources();
  }

  @Post()
  create(@Request() req, @Body() data: any) {
    return this.service.createForm(req.user.companyId, data, req.user.sub);
  }

  @Get(':id')
  get(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.service.getForm(req.user.companyId, id);
  }

  @Put(':id')
  update(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.service.updateForm(req.user.companyId, id, data);
  }

  @Patch(':id/status')
  setStatus(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.service.setFormStatus(req.user.companyId, id, data.status);
  }

  @Post(':id/duplicate')
  duplicate(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.service.duplicateForm(req.user.companyId, id);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.service.deleteForm(req.user.companyId, id);
  }
}
