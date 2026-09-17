import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import axios from 'axios';
import * as path from 'path';
import * as crypto from 'crypto';
import FormData from 'form-data';
import { HttpException, HttpStatus } from '@nestjs/common';

@Injectable()
export class ProjectDiscussionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(companyId: number, projectId: number) {
    return this.prisma.projectDiscussion.findMany({
      where: { projectId, project: { companyId } },
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } } },
        },
        _count: {
          select: { comments: true },
        },
      },
    });
  }

  async get(companyId: number, projectId: number, id: number) {
    const disc = await this.prisma.projectDiscussion.findFirst({
      where: { id, projectId, project: { companyId } },
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } } },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } } },
            },
          },
        },
        attachments: true,
      },
    });
    if (!disc) throw new NotFoundException('Discussion not found');
    return disc;
  }

  async create(user: any, projectId: number, dto: { title: string; content: string; mentionedUserIds?: number[] }) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId: user.sub },
    });
    if (!employee) throw new ForbiddenException('Not an employee');

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId: user.companyId },
    });
    if (!project) throw new NotFoundException('Project not found');

    const disc = await this.prisma.projectDiscussion.create({
      data: {
        title: dto.title,
        content: dto.content,
        projectId,
        authorId: employee.id,
      },
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } } },
        },
        _count: {
          select: { comments: true },
        },
      },
    });

    if (dto.mentionedUserIds && dto.mentionedUserIds.length > 0) {
      for (const mentionedId of dto.mentionedUserIds) {
        if (mentionedId === user.sub) continue;
        await this.notifications.createNotification(mentionedId, 'You were mentioned in a discussion', `${employee.firstName} ${employee.lastName} mentioned you in: ${dto.title}`, 'INFO', `/projects/${projectId}?tab=discussions&id=${disc.id}`, user.companyId);
      }
    }

    return disc;
  }

  async delete(user: any, projectId: number, id: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId: user.sub } });
    if (!employee) throw new ForbiddenException('Not an employee');

    const disc = await this.prisma.projectDiscussion.findFirst({
      where: { id, projectId, project: { companyId: user.companyId } },
    });
    if (!disc) throw new NotFoundException('Discussion not found');

    // Only author or admin can delete
    if (disc.authorId !== employee.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('Not allowed to delete this discussion');
    }

    await this.prisma.projectDiscussion.delete({ where: { id } });
    return { success: true };
  }

  async addComment(user: any, projectId: number, id: number, dto: { content: string; mentionedUserIds?: number[] }) {
    const employee = await this.prisma.employee.findUnique({ where: { userId: user.sub } });
    if (!employee) throw new ForbiddenException('Not an employee');

    const disc = await this.prisma.projectDiscussion.findFirst({
      where: { id, projectId, project: { companyId: user.companyId } },
    });
    if (!disc) throw new NotFoundException('Discussion not found');

    const comment = await this.prisma.projectDiscussionComment.create({
      data: {
        content: dto.content,
        discussionId: id,
        authorId: employee.id,
      },
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } } },
        },
      },
    });

    if (dto.mentionedUserIds && dto.mentionedUserIds.length > 0) {
      for (const mentionedId of dto.mentionedUserIds) {
        if (mentionedId === user.sub) continue;
        await this.notifications.createNotification(mentionedId, 'You were mentioned in a comment', `${employee.firstName} ${employee.lastName} mentioned you in a discussion comment.`, 'INFO', `/projects/${projectId}?tab=discussions&id=${disc.id}`, user.companyId);
      }
    } else if (disc.authorId !== employee.id) {
       // notify author
       const author = await this.prisma.employee.findUnique({ where: { id: disc.authorId } });
       if (author && author.userId) {
         await this.notifications.createNotification(author.userId, 'New comment on your discussion', `${employee.firstName} ${employee.lastName} commented on: ${disc.title}`, 'INFO', `/projects/${projectId}?tab=discussions&id=${disc.id}`, user.companyId);
       }
    }

    return comment;
  }

  async deleteComment(user: any, projectId: number, id: number, commentId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId: user.sub } });
    if (!employee) throw new ForbiddenException('Not an employee');

    const comment = await this.prisma.projectDiscussionComment.findFirst({
      where: { id: commentId, discussionId: id, discussion: { projectId, project: { companyId: user.companyId } } },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    if (comment.authorId !== employee.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('Not allowed to delete this comment');
    }

    await this.prisma.projectDiscussionComment.delete({ where: { id: commentId } });
    return { success: true };
  }


  async uploadAttachment(user: any, projectId: number, id: number, file: Express.Multer.File) {
    const employee = await this.prisma.employee.findUnique({ where: { userId: user.sub } });
    if (!employee) throw new ForbiddenException('Not an employee');

    const disc = await this.prisma.projectDiscussion.findFirst({
      where: { id, projectId, project: { companyId: user.companyId } },
    });
    if (!disc) throw new NotFoundException('Discussion not found');
    if (!file) throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);

    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) throw new HttpException('ImageKit not configured', HttpStatus.INTERNAL_SERVER_ERROR);

    try {
      const ext = path.extname(file.originalname);
      const filename = `${crypto.randomBytes(12).toString('hex')}${ext}`;

      const formData = new FormData();
      formData.append('file', file.buffer, file.originalname);
      formData.append('fileName', filename);
      formData.append('folder', '/nexerp_discussions');

      const authHeader = 'Basic ' + Buffer.from(privateKey + ':').toString('base64');
      const response = await axios.post('https://upload.imagekit.io/api/v1/files/upload', formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: authHeader,
        },
      });

      return await this.prisma.projectDiscussionAttachment.create({
        data: {
          fileName: file.originalname,
          fileUrl: response.data.url,
          fileSize: file.size,
          discussionId: id,
          uploadedById: employee.id,
        },
        include: { uploadedBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
      });
    } catch (error) {
      console.error('Discussion ImageKit upload error:', error.response?.data || error.message);
      throw new HttpException('Failed to upload file to ImageKit', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async addLinkAttachment(user: any, projectId: number, id: number, linkUrl: string, linkName?: string) {
    const employee = await this.prisma.employee.findUnique({ where: { userId: user.sub } });
    if (!employee) throw new ForbiddenException('Not an employee');

    const disc = await this.prisma.projectDiscussion.findFirst({
      where: { id, projectId, project: { companyId: user.companyId } },
    });
    if (!disc) throw new NotFoundException('Discussion not found');

    return await this.prisma.projectDiscussionAttachment.create({
      data: {
        fileName: linkName || linkUrl,
        fileUrl: linkUrl,
        discussionId: id,
        uploadedById: employee.id,
      },
      include: { uploadedBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });
  }

  async deleteAttachment(user: any, projectId: number, id: number, attachmentId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { userId: user.sub } });
    if (!employee) throw new ForbiddenException('Not an employee');

    const att = await this.prisma.projectDiscussionAttachment.findFirst({
      where: { id: attachmentId, discussionId: id, discussion: { projectId, project: { companyId: user.companyId } } },
    });
    if (!att) throw new NotFoundException('Attachment not found');

    if (att.uploadedById !== employee.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('Not allowed to delete this attachment');
    }

    await this.prisma.projectDiscussionAttachment.delete({ where: { id: attachmentId } });
    return { success: true };
  }

}