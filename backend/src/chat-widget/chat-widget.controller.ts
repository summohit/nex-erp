import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Request, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { WebsiteChatAccessGuard } from './website-chat-access.guard';
import { ChatWidgetService, chatAttachmentUpload } from './chat-widget.service';
import { KnowledgeBaseService } from './knowledge-base.service';

// Who may use this is decided by the super admin (Roles & Permissions →
// Website Chat), per role or per person.
@Controller('chat')
@UseGuards(AuthGuard, WebsiteChatAccessGuard)
export class ChatWidgetController {
  constructor(
    private readonly chat: ChatWidgetService,
    private readonly kb: KnowledgeBaseService,
  ) {}

  // ─── Inbox ───

  @Get('inbox')
  inbox(@Request() req, @Query('status') status?: string, @Query('mine') mine?: string) {
    return this.chat.inbox(req.user.companyId, status, mine === '1' ? { employeeId: req.user.employeeId ?? null } : undefined);
  }

  @Get('reports')
  reports(@Request() req, @Query('days') days?: string) {
    return this.chat.reports(req.user.companyId, Number(days) || 30);
  }

  @Get('inbox/:id')
  conversation(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.chat.inboxConversation(req.user.companyId, id);
  }

  @Post('inbox/:id/attachments')
  @UseInterceptors(FileInterceptor('file', chatAttachmentUpload))
  attach(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any, @UploadedFile() file: Express.Multer.File) {
    return this.chat.agentAttachment(req.user.companyId, id, req.user.employeeId ?? null, body ?? {}, file, req);
  }

  @Post('inbox/:id/reply')
  reply(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.chat.agentReply(req.user.companyId, id, req.user.employeeId ?? null, body ?? {});
  }

  @Patch('inbox/:id')
  update(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.chat.updateConversation(req.user.companyId, id, req.user.employeeId ?? null, body ?? {});
  }

  @Post('inbox/:id/convert-lead')
  convertLead(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.chat.convertToLead(req.user.companyId, id, req.user.employeeId ?? null);
  }

  @Post('inbox/:id/convert-ticket')
  convertTicket(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.chat.convertToTicket(req.user.companyId, id, req.user.employeeId ?? null, body ?? {});
  }

  // ─── Widgets ───

  @Get('widgets')
  widgets(@Request() req) {
    return this.chat.listWidgets(req.user.companyId);
  }

  @Post('widgets')
  createWidget(@Request() req, @Body() body: any) {
    return this.chat.createWidget(req.user.companyId, body ?? {});
  }

  @Put('widgets/:id')
  updateWidget(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.chat.updateWidget(req.user.companyId, id, body ?? {});
  }

  @Delete('widgets/:id')
  deleteWidget(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.chat.deleteWidget(req.user.companyId, id);
  }

  // ─── Knowledge base ───

  @Get('kb/categories')
  categories(@Request() req) {
    return this.kb.listCategories(req.user.companyId);
  }

  @Post('kb/categories')
  createCategory(@Request() req, @Body() body: any) {
    return this.kb.createCategory(req.user.companyId, body ?? {});
  }

  @Put('kb/categories/:id')
  updateCategory(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.kb.updateCategory(req.user.companyId, id, body ?? {});
  }

  @Delete('kb/categories/:id')
  deleteCategory(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.kb.deleteCategory(req.user.companyId, id);
  }

  @Get('kb/articles')
  articles(@Request() req, @Query('categoryId') categoryId?: string) {
    return this.kb.listArticles(req.user.companyId, categoryId ? Number(categoryId) : undefined);
  }

  @Get('kb/articles/:id')
  article(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.kb.getArticle(req.user.companyId, id);
  }

  @Post('kb/articles')
  createArticle(@Request() req, @Body() body: any) {
    return this.kb.createArticle(req.user.companyId, body ?? {});
  }

  @Put('kb/articles/:id')
  updateArticle(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.kb.updateArticle(req.user.companyId, id, body ?? {});
  }

  @Delete('kb/articles/:id')
  deleteArticle(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.kb.deleteArticle(req.user.companyId, id);
  }
}
