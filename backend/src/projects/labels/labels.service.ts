import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { canManageTask } from '../../tasks/task-permissions';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LabelsService {
  constructor(private prisma: PrismaService) {}

  async getProjectLabels(projectId: number) {
    return this.prisma.label.findMany({
      where: { projectId },
      orderBy: { id: 'asc' }
    });
  }

  async createLabel(projectId: number, name: string, color: string) {
    return this.prisma.label.create({
      data: {
        name: name || '',
        color: color || '#6b7280',
        projectId
      }
    });
  }

  async updateLabel(projectId: number, labelId: number, name: string, color: string) {
    const label = await this.prisma.label.findFirst({ where: { id: labelId, projectId } });
    if (!label) throw new NotFoundException('Label not found');

    return this.prisma.label.update({
      where: { id: labelId },
      data: {
        name: name !== undefined ? name : label.name,
        color: color !== undefined ? color : label.color
      }
    });
  }

  async deleteLabel(projectId: number, labelId: number) {
    const label = await this.prisma.label.findFirst({ where: { id: labelId, projectId } });
    if (!label) throw new NotFoundException('Label not found');

    return this.prisma.label.delete({
      where: { id: labelId }
    });
  }

  /**
   * Labelling a task is a management act, not part of doing it (§ employee
   * permissions): labels drive filters, reports and what other people see as
   * the shape of the work, so an employee re-tagging their own task changes
   * everybody's picture of the project.
   */
  async toggleIssueLabel(
    projectId: number,
    issueId: number,
    labelId: number,
    companyId?: number,
    actorEmployeeId?: number,
    role?: string,
  ) {
    if (companyId !== undefined) {
      const allowed = await canManageTask(
        this.prisma as any, companyId, projectId, actorEmployeeId, role,
      );
      if (!allowed) {
        throw new ForbiddenException('Only the project manager can change the labels on a task.');
      }
    }

    const existing = await this.prisma.issueLabel.findFirst({
      where: { issueId, labelId }
    });

    if (existing) {
      await this.prisma.issueLabel.delete({
        where: { id: existing.id }
      });
      return { attached: false };
    } else {
      await this.prisma.issueLabel.create({
        data: { issueId, labelId }
      });
      return { attached: true };
    }
  }
}
