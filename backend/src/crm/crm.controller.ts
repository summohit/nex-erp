import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Request, Query, UseGuards, ParseIntPipe, ForbiddenException, UseInterceptors, UploadedFile, HttpException, HttpStatus } from '@nestjs/common';
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

  @Post('leads/sync-contacts')
  syncLeadContactLinks(@Request() req) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Only admins can sync lead contacts.');
    }
    return this.crmService.syncLeadContactLinks(req.user.companyId);
  }

  @Get('leads')
  getLeads(@Request() req, @Query('flow') flow?: string) {
    return this.crmService.getLeads(req.user.companyId, req.user, flow);
  }

  @Post('leads/:id/convert-to-sales')
  convertPreSaleToSales(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.convertPreSaleToSales(req.user.companyId, id, req.user.employeeId);
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
    @Body('purpose') purpose?: string,
  ) {
    const uploaded = await this.processImageKitUpload(file);
    return this.crmService.addLeadFile(req.user.companyId, id, {
      ...file,
      ...uploaded,
      purpose,
    }, req.user.employeeId);
  }

  @Post('leads/:id/follow-ups/:followUpId/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DEAL_FILE_SIZE } }))
  async uploadFollowUpFile(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('followUpId', ParseIntPipe) followUpId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const uploaded = await this.processImageKitUpload(file);
    return this.crmService.addLeadFile(req.user.companyId, id, {
      ...file,
      ...uploaded,
      followUpId,
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

  @Patch('leads/:id/files/:fileId')
  renameLeadFile(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Body('fileName') fileName: string,
  ) {
    return this.crmService.renameLeadFile(req.user.companyId, id, fileId, fileName);
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
  // PRE-SALES
  //
  // Every route resolves what the caller may do from the authenticated user and
  // the stored rows — never from anything in the body. The role checks that used
  // to sit in this controller now live in the service, so that a second caller
  // (a script, the mobile app) cannot reach the same operation unguarded.
  // ═══════════════════════════════════════════

  /** The team, the tasks and the requests for one deal, shaped by who asks. */
  @Get('leads/:id/pre-sales')
  getPreSalesInfo(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.crmService.getPreSalesInfo(req.user.companyId, id, req.user);
  }

  /** Admin only — the one path that adds someone without approval. */
  @Post('leads/:id/pre-sales/members')
  addPreSalesMembers(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.crmService.addPreSalesMembers(req.user.companyId, id, req.user, data);
  }

  @Delete('leads/:id/pre-sales/members/:memberId')
  removePreSalesMember(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('memberId', ParseIntPipe) memberId: number,
  ) {
    return this.crmService.removePreSalesMember(req.user.companyId, id, memberId, req.user);
  }

  // ── requests ───────────────────────────────

  @Post('leads/:id/pre-sales/requests')
  createPreSalesRequest(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.crmService.createPreSalesRequest(req.user.companyId, id, req.user, data);
  }

  /** Ask for more of an existing member's time. An admin's own call applies it. */
  @Post('leads/:id/pre-sales/hours-requests')
  createPreSalesHoursRequest(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.crmService.createPreSalesHoursRequest(req.user.companyId, id, req.user, data);
  }

  /** The administrator's queue, across every deal. */
  @Get('pre-sales/requests')
  listPreSalesRequests(@Request() req, @Query('status') status?: string) {
    return this.crmService.listPreSalesRequests(req.user.companyId, req.user, status);
  }

  /**
   * Approve — optionally with an edited set. The admin may drop people from the
   * request and substitute others, so the body carries what they actually
   * decided; omitting it approves the request as submitted.
   */
  @Patch('pre-sales/requests/:requestId/approve')
  approvePreSalesRequest(
    @Request() req,
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body() data: any,
  ) {
    return this.crmService.approvePreSalesRequest(req.user.companyId, requestId, req.user, data);
  }

  @Patch('pre-sales/requests/:requestId/reject')
  rejectPreSalesRequest(
    @Request() req,
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body() data: any,
  ) {
    return this.crmService.rejectPreSalesRequest(req.user.companyId, requestId, req.user, data);
  }

  // ── tasks ──────────────────────────────────

  @Post('leads/:id/pre-sales/tasks')
  createPreSalesTask(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.crmService.createPreSalesTask(req.user.companyId, id, req.user, data);
  }

  @Put('leads/:id/pre-sales/tasks/:taskId')
  updatePreSalesTask(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() data: any,
  ) {
    return this.crmService.updatePreSalesTask(req.user.companyId, id, taskId, req.user, data);
  }

  /**
   * The only way a task's status moves. Separate from the edit route because
   * the two have different permissions: the assignee drives the status, the
   * creator owns the details.
   */
  @Post('leads/:id/pre-sales/tasks/:taskId/status')
  changePreSalesTaskStatus(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() data: any,
  ) {
    return this.crmService.changePreSalesTaskStatus(req.user.companyId, id, taskId, req.user, data);
  }

  @Delete('leads/:id/pre-sales/tasks/:taskId')
  deletePreSalesTask(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('taskId', ParseIntPipe) taskId: number,
  ) {
    return this.crmService.deletePreSalesTask(req.user.companyId, id, taskId, req.user);
  }

  @Get('leads/:id/pre-sales/tasks/:taskId/history')
  getPreSalesTaskHistory(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('taskId', ParseIntPipe) taskId: number,
  ) {
    return this.crmService.getPreSalesTaskHistory(req.user.companyId, id, taskId, req.user);
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
