import {
  Controller, Get, Post, Delete, Body, Param, Req, UseGuards, ParseIntPipe,
  UseInterceptors, UploadedFile
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../auth/auth.guard';
import { ProjectDiscussionsService } from './project-discussions.service';

@UseGuards(AuthGuard)
@Controller('projects/:projectId/discussions')
export class ProjectDiscussionsController {
  constructor(private readonly discussions: ProjectDiscussionsService) {}

  @Get()
  list(@Req() req, @Param('projectId', ParseIntPipe) projectId: number) {
    return this.discussions.list(req.user.companyId, projectId);
  }

  @Get(':id')
  get(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.discussions.get(req.user.companyId, projectId, id);
  }

  @Post()
  create(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: { title: string; content: string; mentionedUserIds?: number[] },
  ) {
    return this.discussions.create(req.user, projectId, dto);
  }

  @Delete(':id')
  delete(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.discussions.delete(req.user, projectId, id);
  }

  @Post(':id/comments')
  addComment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { content: string; mentionedUserIds?: number[] },
  ) {
    return this.discussions.addComment(req.user, projectId, id, dto);
  }

  @Delete(':id/comments/:commentId')
  deleteComment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('commentId', ParseIntPipe) commentId: number,
  ) {
    return this.discussions.deleteComment(req.user, projectId, id, commentId);
  }

  @Post(':id/attachments/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File
  ) {
    return this.discussions.uploadAttachment(req.user, projectId, id, file);
  }

  @Post(':id/attachments/link')
  addLinkAttachment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { url: string; name?: string }
  ) {
    return this.discussions.addLinkAttachment(req.user, projectId, id, dto.url, dto.name);
  }

  @Delete(':id/attachments/:attachmentId')
  deleteAttachment(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
  ) {
    return this.discussions.deleteAttachment(req.user, projectId, id, attachmentId);
  }
}
