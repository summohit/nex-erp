import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, Query } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('v1/clients')
@UseGuards(AuthGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
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
  update(@Req() req: any, @Param('id') id: string, @Body() updateClientDto: any) {
    return this.clientsService.update(req.user.companyId, +id, updateClientDto);
  }

  @Patch(':id/archive')
  archive(@Req() req: any, @Param('id') id: string) {
    return this.clientsService.archive(req.user.companyId, +id);
  }

  @Patch(':id/restore')
  restore(@Req() req: any, @Param('id') id: string) {
    return this.clientsService.restore(req.user.companyId, +id);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.clientsService.remove(req.user.companyId, +id);
  }
}
