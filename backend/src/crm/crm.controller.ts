import { Controller, Get, Post, Put, Delete, Body, Param, Request, Query, UseGuards, ParseIntPipe, ForbiddenException, UseInterceptors, UploadedFile, HttpException, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as path from 'path';
import * as crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
import { CrmService } from './crm.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

const MAX_DEAL_FILE_SIZE = 20 * 1024 * 1024;

@Controller('crm')
@UseGuards(AuthGuard, PermissionsGuard)
@Permissions('crm/leads')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  private async processImageKitUpload(file: Express.Multer.File) {
    if (!file) {
      throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);
    }

    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) {
      throw new HttpException('ImageKit not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      const ext = path.extname(file.originalname);
      const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;

      const form = new FormData();
      form.append('file', file.buffer.toString('base64'));
      form.append('fileName', filename);
      form.append('folder', '/erp_uploads');

      const authHeader = 'Basic ' + Buffer.from(privateKey + ':').toString('base64');

      const response = await axios.post('https://upload.imagekit.io/api/v1/files/upload', form, {
        headers: {
          ...form.getHeaders(),
          Authorization: authHeader
        }
      });

      return { url: response.data.url };
    } catch (error: any) {
      console.error('ImageKit upload error:', error.response?.data || error.message);
      const providerMessage = error.response?.data?.message;
      throw new HttpException(
        providerMessage ? `Failed to upload file: ${providerMessage}` : 'Failed to upload file. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

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

  @Get('leads/:id')
  getLeadById(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.getLeadById(req.user.companyId, id, req.user);
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
    return this.crmService.updateLead(req.user.companyId, id, data, req.user.employeeId);
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
  // DEAL FILES
  // ═══════════════════════════════════════════

  @Get('leads/:id/files')
  getLeadFiles(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.getLeadFiles(req.user.companyId, id);
  }

  @Post('leads/:id/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DEAL_FILE_SIZE } }))
  async uploadLeadFile(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const uploaded = await this.processImageKitUpload(file);
    return this.crmService.addLeadFile(req.user.companyId, id, {
      ...file,
      ...uploaded,
    }, req.user.employeeId);
  }

  @Delete('leads/:id/files/:fileId')
  deleteLeadFile(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
  ) {
    return this.crmService.deleteLeadFile(req.user.companyId, id, fileId);
  }

  // ═══════════════════════════════════════════
  // DEAL NOTES
  // ═══════════════════════════════════════════

  @Get('leads/:id/notes')
  getLeadNotes(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.getLeadNotes(req.user.companyId, id);
  }

  @Post('leads/:id/notes')
  createLeadNote(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.crmService.createLeadNote(req.user.companyId, id, data, req.user.employeeId);
  }

  @Put('leads/:id/notes/:noteId')
  updateLeadNote(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('noteId', ParseIntPipe) noteId: number,
    @Body() data: any,
  ) {
    return this.crmService.updateLeadNote(req.user.companyId, id, noteId, data, req.user.employeeId);
  }

  @Delete('leads/:id/notes/:noteId')
  deleteLeadNote(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('noteId', ParseIntPipe) noteId: number,
  ) {
    return this.crmService.deleteLeadNote(req.user.companyId, id, noteId, req.user.employeeId);
  }

  // ═══════════════════════════════════════════
  // DEAL HISTORY / ACTIVITY
  // ═══════════════════════════════════════════

  @Get('leads/:id/history')
  getLeadHistory(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.getLeadHistory(req.user.companyId, id);
  }

  // ═══════════════════════════════════════════
  // LEAD CONTACT ENDPOINTS
  // ═══════════════════════════════════════════

  @Get('lead-contacts')
  getLeadContacts(@Request() req) {
    return this.crmService.getLeadContacts(req.user.companyId, {
      role: req.user.role,
      employeeId: req.user.employeeId,
    });
  }

  @Get('lead-contacts/:id')
  getLeadContactById(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.getLeadContactById(req.user.companyId, id);
  }

  @Post('lead-contacts')
  createLeadContact(@Request() req, @Body() data: any) {
    if (data.addedById) data.addedById = parseInt(data.addedById, 10);
    return this.crmService.createLeadContact(req.user.companyId, req.user.sub, data);
  }

  @Post('lead-contacts/import')
  importLeadContacts(@Request() req, @Body() data: any) {
    const addedById = data.addedById ? parseInt(data.addedById, 10) : null;
    return this.crmService.importLeadContacts(req.user.companyId, req.user.sub, data.contacts, addedById);
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

  @Post('lead-contacts/:id/convert-to-client')
  convertLeadContactToClient(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.convertLeadContactToClient(req.user.companyId, id);
  }

  // ═══════════════════════════════════════════
  // LEAD CONTACT NOTES
  // ═══════════════════════════════════════════

  @Get('lead-contacts/:id/notes')
  getLeadContactNotes(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.getLeadContactNotes(req.user.companyId, id);
  }

  @Post('lead-contacts/:id/notes')
  createLeadContactNote(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.crmService.createLeadContactNote(req.user.companyId, id, data, req.user.employeeId);
  }

  @Put('lead-contacts/:id/notes/:noteId')
  updateLeadContactNote(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('noteId', ParseIntPipe) noteId: number,
    @Body() data: any,
  ) {
    return this.crmService.updateLeadContactNote(req.user.companyId, id, noteId, data);
  }

  @Delete('lead-contacts/:id/notes/:noteId')
  deleteLeadContactNote(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('noteId', ParseIntPipe) noteId: number,
  ) {
    return this.crmService.deleteLeadContactNote(req.user.companyId, id, noteId);
  }
}
