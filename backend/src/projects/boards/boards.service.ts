import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BoardsService {
  constructor(private prisma: PrismaService) {}

  private async assertOwner(companyId: number, projectId: number, employeeId: number, role?: string) {
    if (role === 'SUPERADMIN' || role === 'ADMIN') return;

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      select: { leadId: true }
    });
    if (!project) throw new NotFoundException('Project not found');

    if (project.leadId !== employeeId) {
      throw new ForbiddenException('Only the project owner can perform this action');
    }
  }

  async getBoard(companyId: number, projectId: number) {
    const board = await this.prisma.board.findFirst({
      where: { projectId, project: { companyId } },
      include: {
        columns: {
          where: { isArchived: false },
          orderBy: { position: 'asc' }
        }
      }
    });

    if (!board) throw new NotFoundException('Board not found');
    return board;
  }

  async createColumn(companyId: number, projectId: number, data: { name: string, color?: string }, employeeId: number, role?: string) {
    await this.assertOwner(companyId, projectId, employeeId, role);

    const board = await this.prisma.board.findFirst({
      where: { projectId, project: { companyId } }
    });
    if (!board) throw new NotFoundException('Board not found');

    // Find max position
    const maxPosCol = await this.prisma.boardColumn.findFirst({
      where: { boardId: board.id },
      orderBy: { position: 'desc' }
    });
    const nextPos = maxPosCol ? maxPosCol.position + 1 : 0;

    return this.prisma.boardColumn.create({
      data: {
        name: data.name,
        color: data.color || '#6b7280',
        position: nextPos,
        boardId: board.id
      }
    });
  }

  async updateColumn(companyId: number, projectId: number, columnId: number, data: { color?: string, name?: string, position?: number }, employeeId: number, role?: string) {
    if (data.name !== undefined) {
      await this.assertOwner(companyId, projectId, employeeId, role);
    }

    const board = await this.prisma.board.findFirst({
      where: { projectId, project: { companyId } }
    });
    if (!board) throw new NotFoundException('Board not found');

    const col = await this.prisma.boardColumn.findFirst({
      where: { id: columnId, boardId: board.id }
    });
    if (!col) throw new NotFoundException('Column not found');

    return this.prisma.boardColumn.update({
      where: { id: columnId },
      data
    });
  }

  async deleteColumn(companyId: number, projectId: number, columnId: number) {
    const board = await this.prisma.board.findFirst({
      where: { projectId, project: { companyId } }
    });
    if (!board) throw new NotFoundException('Board not found');

    const col = await this.prisma.boardColumn.findFirst({
      where: { id: columnId, boardId: board.id }
    });
    if (!col) throw new NotFoundException('Column not found');
    
    if (col.isSystem) {
      throw new BadRequestException('Cannot delete default system columns. You can only rename them.');
    }

    return this.prisma.boardColumn.update({
      where: { id: columnId },
      data: { isArchived: true }
    });
  }

  async getArchivedColumns(companyId: number, projectId: number) {
    const board = await this.prisma.board.findFirst({
      where: { projectId, project: { companyId } }
    });
    if (!board) throw new NotFoundException('Board not found');

    return this.prisma.boardColumn.findMany({
      where: { boardId: board.id, isArchived: true },
      orderBy: { position: 'asc' }
    });
  }

  async unarchiveColumn(companyId: number, projectId: number, columnId: number) {
    const board = await this.prisma.board.findFirst({
      where: { projectId, project: { companyId } }
    });
    if (!board) throw new NotFoundException('Board not found');

    const col = await this.prisma.boardColumn.findFirst({
      where: { id: columnId, boardId: board.id }
    });
    if (!col) throw new NotFoundException('Column not found');

    return this.prisma.boardColumn.update({
      where: { id: columnId },
      data: { isArchived: false }
    });
  }

  async reorderColumns(companyId: number, projectId: number, columnIds: number[]) {
    const board = await this.prisma.board.findFirst({
      where: { projectId, project: { companyId } }
    });
    if (!board) throw new NotFoundException('Board not found');

    // First update to temporary negative positions to avoid unique constraint violations on (boardId, position)
    const tempUpdates = columnIds.map(id => 
      this.prisma.boardColumn.update({
        where: { id, boardId: board.id },
        data: { position: -id }
      })
    );

    // Then update to final correct positions
    const finalUpdates = columnIds.map((id, index) => 
      this.prisma.boardColumn.update({
        where: { id, boardId: board.id },
        data: { position: index }
      })
    );

    await this.prisma.$transaction([...tempUpdates, ...finalUpdates]);
    return { success: true };
  }
}
