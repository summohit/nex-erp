import { Injectable, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import axios from 'axios';
import * as path from 'path';
import * as crypto from 'crypto';
import FormData from 'form-data';
import { TasksGateway } from '../../events/tasks/tasks.gateway';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class IssuesService {
  constructor(
    private prisma: PrismaService,
    private tasksGateway: TasksGateway,
    private notificationsService: NotificationsService
  ) {}

  async createIssue(companyId: number, reporterId: number, projectId: number, data: any) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId, companyId } });
    if (!project) throw new NotFoundException('Project not found');

    const count = await this.prisma.issue.count({ where: { projectId, companyId } });
    const key = `${project.key}-${count + 1}`;

    let columnId = data.columnId;
    if (!columnId) {
      const board = await this.prisma.board.findFirst({ 
        where: { projectId }, 
        include: { columns: { orderBy: { position: 'asc' } } } 
      });
      if (board && board.columns.length > 0) {
        columnId = board.columns[0].id;
      }
    }

    // Get max position in that column
    const lastIssue = await this.prisma.issue.findFirst({
      where: { columnId },
      orderBy: { position: 'desc' }
    });
    const position = lastIssue ? lastIssue.position + 1 : 0;

    const issue = await this.prisma.issue.create({
      data: {
        key,
        title: data.title,
        description: data.description,
        type: data.type || 'TASK',
        priority: data.priority || 'MEDIUM',
        projectId,
        companyId,
        columnId,
        reporterId,
        assigneeId: data.assigneeId,
        position,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        parentId: data.parentId ? Number(data.parentId) : null
      }
    });

    const activity = await this.prisma.issueActivity.create({
      data: { action: 'CREATED', issueId: issue.id, actorId: reporterId },
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      }
    });

    this.tasksGateway.emitIssueUpdated(issue.id, projectId, issue);
    this.tasksGateway.emitActivityAdded(issue.id, activity);

    return issue;
  }

  async getIssues(companyId: number, projectId: number) {
    return this.prisma.issue.findMany({
      where: { projectId, companyId },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        reporter: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        labels: { include: { label: true } },
        members: { include: { employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } }, designation: { select: { name: true } } } } } },
        attachments: { include: { uploader: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
        parent: { select: { id: true, key: true, title: true, type: true, status: true } },
        children: { select: { id: true, key: true, title: true, type: true, status: true, priority: true, assignee: { select: { avatarUrl: true } } }, orderBy: { position: 'asc' } },
        timeLogs: { select: { id: true, durationMin: true, startedAt: true, endedAt: true } },
        _count: { select: { comments: true } }
      },
      orderBy: { position: 'asc' }
    });
  }

  async updateIssue(companyId: number, employeeId: number, projectId: number, issueId: number, data: any) {
    const oldIssue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!oldIssue) throw new NotFoundException('Issue not found');

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.columnId !== undefined) {
      updateData.columnId = Number(data.columnId);
      if (data.status === undefined) {
        const targetCol = await this.prisma.boardColumn.findUnique({ where: { id: updateData.columnId } });
        if (targetCol) {
          const colName = targetCol.name.toLowerCase();
          if (colName.includes('done') || colName.includes('complete')) updateData.status = 'DONE';
          else if (colName.includes('progress') || colName.includes('doing')) updateData.status = 'IN_PROGRESS';
          else if (colName.includes('review')) updateData.status = 'IN_REVIEW';
          else if (colName.includes('to do') || colName.includes('todo')) updateData.status = 'TODO';
        }
      }
    }
    if (data.assigneeId !== undefined) updateData.assigneeId = data.assigneeId ? Number(data.assigneeId) : null;
    if (data.parentId !== undefined) updateData.parentId = data.parentId ? Number(data.parentId) : null;
    if (data.position !== undefined) updateData.position = Number(data.position);
    if (data.startDate !== undefined) updateData.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (data.recurring !== undefined) updateData.recurring = data.recurring;
    if (data.dueReminder !== undefined) updateData.dueReminder = data.dueReminder;
    if (data.estimatedHours !== undefined) updateData.estimatedHours = data.estimatedHours ? Number(data.estimatedHours) : null;

    const issue = await this.prisma.issue.update({
      where: { id: issueId },
      data: updateData
    });

    // Simple activity logging for column change
    if (data.columnId && Number(data.columnId) !== oldIssue.columnId) {
      const activity = await this.prisma.issueActivity.create({
        data: {
          action: 'STATUS_CHANGED',
          field: 'columnId',
          oldValue: oldIssue.columnId?.toString(),
          newValue: data.columnId.toString(),
          issueId,
          actorId: employeeId
        },
        include: {
          actor: {
            select: { id: true, firstName: true, lastName: true, avatarUrl: true }
          }
        }
      });
      this.tasksGateway.emitActivityAdded(issueId, activity);
    }

    this.tasksGateway.emitIssueUpdated(issueId, projectId, issue);

    return issue;
  }

  async toggleArchive(companyId: number, employeeId: number, projectId: number, issueId: number) {
    const oldIssue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!oldIssue) throw new NotFoundException('Issue not found');

    const issue = await this.prisma.issue.update({
      where: { id: issueId },
      data: { isArchived: !oldIssue.isArchived }
    });

    await this.prisma.issueActivity.create({
      data: {
        action: issue.isArchived ? 'ARCHIVED' : 'UNARCHIVED',
        issueId,
        actorId: employeeId
      }
    });

    return issue;
  }

  async startTimeTracking(companyId: number, employeeId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    const now = new Date();
    await this.prisma.issue.update({
      where: { id: issueId },
      data: { workStartedAt: now, workCompletedAt: null }
    });

    await this.prisma.issueTimeLog.create({
      data: { issueId, employeeId, startedAt: now }
    });

    await this.prisma.issueActivity.create({
      data: { action: 'WORK_STARTED', issueId, actorId: employeeId }
    });

    return { success: true, startedAt: now };
  }

  async stopTimeTracking(companyId: number, employeeId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    const now = new Date();
    
    // Close the latest open time log
    const openLog = await this.prisma.issueTimeLog.findFirst({
      where: { issueId, employeeId, endedAt: null },
      orderBy: { startedAt: 'desc' }
    });

    if (openLog) {
      const durationMin = Math.round((now.getTime() - openLog.startedAt.getTime()) / 60000);
      await this.prisma.issueTimeLog.update({
        where: { id: openLog.id },
        data: { endedAt: now, durationMin }
      });
    }

    await this.prisma.issue.update({
      where: { id: issueId },
      data: { workCompletedAt: now }
    });

    await this.prisma.issueActivity.create({
      data: { action: 'WORK_STOPPED', issueId, actorId: employeeId }
    });

    return { success: true, completedAt: now };
  }

  async addManualTimeLog(companyId: number, employeeId: number, projectId: number, issueId: number, data: { durationMin: number }) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    const now = new Date();
    const startedAt = new Date(now.getTime() - data.durationMin * 60000);

    const log = await this.prisma.issueTimeLog.create({
      data: {
        issueId,
        employeeId,
        startedAt,
        endedAt: now,
        durationMin: data.durationMin
      }
    });

    await this.prisma.issueActivity.create({
      data: { action: 'TIME_LOGGED', issueId, actorId: employeeId }
    });

    return { success: true, log };
  }

  async getComments(companyId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    return this.prisma.issueComment.findMany({
      where: { issueId },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  async getActivities(companyId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    return this.prisma.issueActivity.findMany({
      where: { issueId },
      include: {
        actor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  async addComment(companyId: number, userId: number, projectId: number, issueId: number, body: string) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    const authorId = employee ? employee.id : userId;

    const comment = await this.prisma.issueComment.create({
      data: {
        body,
        issueId,
        authorId
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true
          }
        }
      }
    });

    const activity = await this.prisma.issueActivity.create({
      data: {
        action: 'COMMENT_ADDED',
        issueId,
        actorId: authorId
      },
      include: {
        actor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true
          }
        }
      }
    });

    this.tasksGateway.emitCommentAdded(issueId, comment);
    this.tasksGateway.emitActivityAdded(issueId, activity);

    // Notify assignee or reporter
    const notifyUserId = issue.assigneeId && issue.assigneeId !== authorId ? issue.assigneeId : 
                         issue.reporterId && issue.reporterId !== authorId ? issue.reporterId : null;
    
    if (notifyUserId) {
      const u = await this.prisma.employee.findUnique({ where: { id: notifyUserId }, select: { userId: true } });
      if (u) {
        await this.notificationsService.createNotification(
          u.userId,
          `New Comment on ${issue.key}`,
          `${comment.author?.firstName || 'Someone'} commented: ${body.substring(0, 50)}...`,
          'INFO',
          `/projects/${projectId}?issue=${issue.key}`,
          companyId
        );
      }
    }

    return comment;
  }

  async deleteComment(companyId: number, projectId: number, issueId: number, commentId: number) {
    const comment = await this.prisma.issueComment.findUnique({ where: { id: commentId, issueId } });
    if (!comment) throw new NotFoundException('Comment not found');

    return this.prisma.issueComment.delete({
      where: { id: commentId }
    });
  }

  async getChecklists(companyId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    return this.prisma.checklist.findMany({
      where: { issueId },
      include: {
        items: {
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  async createChecklist(companyId: number, projectId: number, issueId: number, title: string) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    return this.prisma.checklist.create({
      data: {
        title: title || 'Checklist',
        issueId
      },
      include: {
        items: true
      }
    });
  }

  async updateChecklist(companyId: number, projectId: number, issueId: number, checklistId: number, title: string) {
    const checklist = await this.prisma.checklist.findUnique({ where: { id: checklistId, issueId } });
    if (!checklist) throw new NotFoundException('Checklist not found');

    return this.prisma.checklist.update({
      where: { id: checklistId },
      data: { title: title || 'Checklist' }
    });
  }

  async deleteChecklist(companyId: number, projectId: number, issueId: number, checklistId: number) {
    const checklist = await this.prisma.checklist.findUnique({ where: { id: checklistId, issueId } });
    if (!checklist) throw new NotFoundException('Checklist not found');

    return this.prisma.checklist.delete({
      where: { id: checklistId }
    });
  }

  async addChecklistItem(companyId: number, projectId: number, issueId: number, checklistId: number, title: string) {
    const checklist = await this.prisma.checklist.findUnique({ where: { id: checklistId, issueId } });
    if (!checklist) throw new NotFoundException('Checklist not found');

    return this.prisma.checklistItem.create({
      data: {
        title,
        checklistId
      }
    });
  }

  async updateChecklistItem(companyId: number, projectId: number, issueId: number, checklistId: number, itemId: number, data: any) {
    const item = await this.prisma.checklistItem.findFirst({ where: { id: itemId, checklistId } });
    if (!item) throw new NotFoundException('Checklist item not found');

    const updateData: any = {};
    if (data.isCompleted !== undefined) updateData.isCompleted = Boolean(data.isCompleted);
    if (data.title !== undefined) updateData.title = data.title;

    return this.prisma.checklistItem.update({
      where: { id: itemId },
      data: updateData
    });
  }

  async deleteChecklistItem(companyId: number, projectId: number, issueId: number, checklistId: number, itemId: number) {
    const item = await this.prisma.checklistItem.findFirst({ where: { id: itemId, checklistId } });
    if (!item) throw new NotFoundException('Checklist item not found');

    return this.prisma.checklistItem.delete({
      where: { id: itemId }
    });
  }

  async generateChecklist(companyId: number, projectId: number, issueId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    const description = issue.description || issue.title;
    
    // First create an empty checklist
    const checklist = await this.prisma.checklist.create({
      data: { title: 'Checklist', issueId }
    });

    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.1-8b-instant',
          messages: [
            {
              role: 'system',
              content: 'You are a project management assistant. Break down the given task into a checklist. Return ONLY a valid JSON object with an "items" array containing strings. Example: {"items": ["task 1", "task 2"]}'
            },
            {
              role: 'user',
              content: `Generate a checklist for the following task:\n\nTitle: ${issue.title}\nDescription: ${description}`
            }
          ],
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0]?.message?.content;
      if (!content) throw new Error('No content from Groq');

      const parsed = JSON.parse(content);
      const items = Array.isArray(parsed.items) ? parsed.items : [];

      if (items.length === 0) {
        items.push('Review requirements', 'Execute task', 'Verify completion');
      }

      // Save to database inside the newly created checklist
      await Promise.all(
        items.slice(0, 10).map((title: string) => 
          this.prisma.checklistItem.create({
            data: { title: String(title).substring(0, 255), checklistId: checklist.id }
          })
        )
      );

      return this.prisma.checklist.findUnique({
        where: { id: checklist.id },
        include: { items: { orderBy: { createdAt: 'asc' } } }
      });
    } catch (error: any) {
      console.error('Groq generation error:', error?.response?.data || error.message);
      
      // Fallback if API fails
      await Promise.all(
        ['Review task details', 'Draft implementation plan', 'Execute implementation', 'Test changes'].map(title => 
          this.prisma.checklistItem.create({
            data: { title, checklistId: checklist.id }
          })
        )
      );
      
      return this.prisma.checklist.findUnique({
        where: { id: checklist.id },
        include: { items: { orderBy: { createdAt: 'asc' } } }
      });
    }
  }

  async getCompanyMembers(companyId: number) {
    return this.prisma.employee.findMany({
      where: { companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        user: { select: { email: true } },
        designation: { select: { name: true } }
      },
      orderBy: { firstName: 'asc' }
    });
  }

  async toggleIssueMember(companyId: number, projectId: number, issueId: number, employeeId: number) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');

    const existing = await this.prisma.issueMember.findUnique({
      where: {
        issueId_employeeId: { issueId, employeeId }
      }
    });

    if (existing) {
      await this.prisma.issueMember.delete({
        where: { issueId_employeeId: { issueId, employeeId } }
      });
      return { attached: false, employeeId };
    } else {
      const created = await this.prisma.issueMember.create({
        data: { issueId, employeeId },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } }, designation: { select: { name: true } } } }
        }
      });
      
      // Auto-add to project members if not already a member
      const isProjectMember = await this.prisma.projectMember.findUnique({
        where: { projectId_employeeId: { projectId, employeeId } }
      });
      if (!isProjectMember) {
        await this.prisma.projectMember.create({
          data: { projectId, employeeId, role: 'MEMBER' }
        });
      }

      return { attached: true, member: created };
    }
  }

  async uploadAttachmentToImageKit(companyId: number, employeeId: number, projectId: number, issueId: number, file: Express.Multer.File) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');
    if (!file) throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);

    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) throw new HttpException('ImageKit not configured', HttpStatus.INTERNAL_SERVER_ERROR);

    try {
      const ext = path.extname(file.originalname);
      const filename = `${crypto.randomBytes(12).toString('hex')}${ext}`;

      const form = new FormData();
      form.append('file', file.buffer, filename);
      form.append('fileName', filename);
      form.append('folder', '/card_attachments');

      const authHeader = 'Basic ' + Buffer.from(privateKey + ':').toString('base64');

      const response = await axios.post('https://upload.imagekit.io/api/v1/files/upload', form, {
        headers: {
          ...form.getHeaders(),
          Authorization: authHeader
        }
      });

      const fileUrl = response.data.url;

      return await this.prisma.issueAttachment.create({
        data: {
          fileName: file.originalname,
          fileUrl,
          fileSize: file.size,
          fileType: 'FILE',
          issueId,
          uploadedBy: employeeId
        },
        include: { uploader: { select: { id: true, firstName: true, lastName: true } } }
      });
    } catch (error: any) {
      console.error('Attachment ImageKit upload error:', error.response?.data || error.message);
      throw new HttpException('Failed to upload file to ImageKit', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async addLinkAttachment(companyId: number, employeeId: number, projectId: number, issueId: number, linkUrl: string, linkName?: string) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!issue) throw new NotFoundException('Issue not found');
    if (!linkUrl) throw new HttpException('Link URL is required', HttpStatus.BAD_REQUEST);

    let formattedUrl = linkUrl.trim();
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = 'https://' + formattedUrl;
    }

    return await this.prisma.issueAttachment.create({
      data: {
        fileName: (linkName && linkName.trim()) ? linkName.trim() : formattedUrl,
        fileUrl: formattedUrl,
        fileType: 'LINK',
        issueId,
        uploadedBy: employeeId
      },
      include: { uploader: { select: { id: true, firstName: true, lastName: true } } }
    });
  }

  async deleteAttachment(companyId: number, projectId: number, issueId: number, attachmentId: number) {
    const attachment = await this.prisma.issueAttachment.findFirst({
      where: { id: attachmentId, issueId }
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    if (attachment.isCover) {
      await this.prisma.issue.update({
        where: { id: issueId },
        data: { coverUrl: null }
      });
    }

    // We can't delete from ImageKit because we don't have the fileId stored reliably.
    // However, since it is important to delete it, we could try to parse the fileId from the URL or query ImageKit
    // But for now, we'll just delete it from the DB to prevent crashes.

    await this.prisma.issueAttachment.delete({ where: { id: attachmentId } });
    return { success: true, attachmentId };
  }

  async toggleCoverAttachment(companyId: number, projectId: number, issueId: number, attachmentId: number) {
    const attachment = await this.prisma.issueAttachment.findFirst({
      where: { id: attachmentId, issueId }
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    const newCoverState = !attachment.isCover;

    if (newCoverState) {
      await this.prisma.issueAttachment.updateMany({
        where: { issueId },
        data: { isCover: false }
      });
    }

    await this.prisma.issueAttachment.update({
      where: { id: attachmentId },
      data: { isCover: newCoverState }
    });

    const updatedIssue = await this.prisma.issue.update({
      where: { id: issueId },
      data: { coverUrl: newCoverState ? attachment.fileUrl : null }
    });

    return { isCover: newCoverState, coverUrl: updatedIssue.coverUrl, attachmentId };
  }
}
