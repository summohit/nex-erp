import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class IssuesService {
  constructor(private prisma: PrismaService) {}

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
        position
      }
    });

    await this.prisma.issueActivity.create({
      data: { action: 'CREATED', issueId: issue.id, actorId: reporterId }
    });

    return issue;
  }

  async getIssues(companyId: number, projectId: number) {
    return this.prisma.issue.findMany({
      where: { projectId, companyId },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        reporter: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        labels: { include: { label: true } }
      },
      orderBy: { position: 'asc' }
    });
  }

  async updateIssue(companyId: number, employeeId: number, projectId: number, issueId: number, data: any) {
    const oldIssue = await this.prisma.issue.findUnique({ where: { id: issueId, companyId, projectId } });
    if (!oldIssue) throw new NotFoundException('Issue not found');

    const issue = await this.prisma.issue.update({
      where: { id: issueId },
      data
    });

    // Simple activity logging for column change
    if (data.columnId && data.columnId !== oldIssue.columnId) {
      await this.prisma.issueActivity.create({
        data: {
          action: 'STATUS_CHANGED',
          field: 'columnId',
          oldValue: oldIssue.columnId?.toString(),
          newValue: data.columnId.toString(),
          issueId,
          actorId: employeeId
        }
      });
    }

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
}
