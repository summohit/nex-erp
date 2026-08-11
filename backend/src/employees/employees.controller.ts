import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EmployeesService } from './employees.service';
import { EmployeesImportService } from './employees-import.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('employees')
@UseGuards(AuthGuard)
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly employeesImportService: EmployeesImportService
  ) {}

  @Post('bulk-upload')
  @UseInterceptors(FileInterceptor('file'))
  async bulkUpload(
    @Request() req, 
    @UploadedFile() file: Express.Multer.File,
    @Body('departmentId') departmentId?: string,
    @Body('designationId') designationId?: string,
    @Body('role') role?: string
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }
    if (!file.originalname.endsWith('.csv')) {
      throw new BadRequestException('Only .csv files are supported.');
    }
    return this.employeesImportService.processCsv(
      req.user.companyId, 
      file.buffer,
      departmentId ? parseInt(departmentId, 10) : null,
      designationId ? parseInt(designationId, 10) : null,
      role || null
    );
  }

  @Get()
  findAll(@Request() req) {
    return this.employeesService.findAll(req.user.companyId);
  }

  @Get('org-chart')
  getOrgChart(@Request() req) {
    return this.employeesService.getOrgChart(req.user.companyId);
  }

  @Post()
  create(@Request() req, @Body() data: any) {
    return this.employeesService.create(req.user.companyId, data);
  }

  @Put(':id')
  update(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.employeesService.update(+id, req.user.companyId, data);
  }

  @Delete(':id')
  delete(@Request() req, @Param('id') id: string) {
    return this.employeesService.delete(+id, req.user.companyId);
  }

  @Get('me/profile')
  getMyProfile(@Request() req) {
    return this.employeesService.getMyProfile(req.user.companyId, req.user.sub);
  }

  @Get(':id/profile')
  getProfile(@Request() req, @Param('id') id: string) {
    return this.employeesService.getProfile(+id, req.user.companyId, req.user.sub);
  }

  @Put(':id/profile')
  updateProfile(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.employeesService.updateProfile(+id, req.user.companyId, req.user.sub, req.user.role, data);
  }

  @Post(':id/contacts')
  addContact(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.employeesService.addContact(+id, req.user.companyId, req.user.sub, req.user.role, data);
  }

  @Delete(':id/contacts/:contactId')
  deleteContact(@Request() req, @Param('id') id: string, @Param('contactId') contactId: string) {
    return this.employeesService.deleteContact(+id, +contactId, req.user.companyId, req.user.sub, req.user.role);
  }

  @Post(':id/documents')
  addDocument(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.employeesService.addDocument(+id, req.user.companyId, req.user.sub, req.user.role, data);
  }

  @Post(':id/documents/bulk')
  addDocuments(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.employeesService.addDocuments(+id, req.user.companyId, req.user.sub, req.user.role, data);
  }

  @Delete(':id/documents/:documentId')
  deleteDocument(@Request() req, @Param('id') id: string, @Param('documentId') documentId: string) {
    return this.employeesService.deleteDocument(+id, +documentId, req.user.companyId, req.user.sub, req.user.role);
  }
}
