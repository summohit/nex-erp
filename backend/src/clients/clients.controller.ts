import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, Query } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('v1/clients')
// Reading clients stays open: timesheets, projects, quotations and leads all
// pick from the list. Changing them needs the clients permission (Admin and
// Super Admin always pass); until now any signed-in employee could.
@UseGuards(AuthGuard, PermissionsGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @Permissions('clients')
  create(@Req() req: any, @Body() createClientDto: any) {
    return this.clientsService.create(req.user.companyId, createClientDto);
  }

  @Get()
  findAll(@Req() req: any, @Query('status') status?: string) {
    return this.clientsService.findAll(req.user.companyId, status);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.clientsService.findOne(req.user.companyId, +id);
  }

  @Patch(':id')
  @Permissions('clients')
  update(@Req() req: any, @Param('id') id: string, @Body() updateClientDto: any) {
    return this.clientsService.update(req.user.companyId, +id, updateClientDto);
  }

  @Patch(':id/archive')
  @Permissions('clients')
  archive(@Req() req: any, @Param('id') id: string) {
    return this.clientsService.archive(req.user.companyId, +id);
  }

  @Patch(':id/restore')
  @Permissions('clients')
  restore(@Req() req: any, @Param('id') id: string) {
    return this.clientsService.restore(req.user.companyId, +id);
  }

  @Delete(':id')
  @Permissions('clients')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.clientsService.remove(req.user.companyId, +id);
  }

  @Post(':id/contacts')
  @Permissions('clients')
  addContact(@Req() req: any, @Param('id') id: string, @Body() contactDto: any) {
    return this.clientsService.addContact(req.user.companyId, +id, contactDto);
  }

  @Patch(':id/contacts/:contactId')
  @Permissions('clients')
  updateContact(@Req() req: any, @Param('id') id: string, @Param('contactId') contactId: string, @Body() contactDto: any) {
    return this.clientsService.updateContact(req.user.companyId, +id, +contactId, contactDto);
  }

  @Delete(':id/contacts/:contactId')
  @Permissions('clients')
  deleteContact(@Req() req: any, @Param('id') id: string, @Param('contactId') contactId: string) {
    return this.clientsService.deleteContact(req.user.companyId, +id, +contactId);
  }
}
