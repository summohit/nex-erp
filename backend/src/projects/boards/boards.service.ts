import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BoardsService {
  constructor(private prisma: PrismaService) {}

  async getBoard(companyId: number, projectId: number) {
    const board = await this.prisma.board.findFirst({
      where: { projectId, project: { companyId } },
      include: {
        columns: {
          orderBy: { position: 'asc' }
        }
      }
    });

    if (!board) throw new NotFoundException('Board not found');
    return board;
  }

  async createColumn(companyId: number, projectId: number, data: { name: string, color?: string }) {
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

  async updateColumn(companyId: number, projectId: number, columnId: number, data: { color?: string, name?: string, position?: number }) {
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

    return this.prisma.boardColumn.delete({
      where: { id: columnId }
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
