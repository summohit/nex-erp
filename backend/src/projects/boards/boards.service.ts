import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveProjectViewer, mayChangeAnyTask } from '../project-roles';

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

  /**
   * Who may change the shape of the board.
   *
   * The columns are the board, so this is the same standing as changing the
   * work on it: the owner, a project manager, or a company administrator.
   *
   * It exists because three of these endpoints had no check at all — deleting
   * a column, reordering them and restoring an archived one were reachable by
   * any signed-in employee, on any project in the company. Hiding the menu
   * from a technical architect in the browser did nothing about that.
   */
  private async assertMayChangeBoard(
    companyId: number, projectId: number, employeeId: number | null, role?: string,
  ): Promise<void> {
    const viewer = await resolveProjectViewer(
      this.prisma as any, companyId, projectId, employeeId, role,
    );
    if (!mayChangeAnyTask(viewer)) {
      throw new ForbiddenException(
        'Only the project owner, a project manager or an administrator can change this board.',
      );
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
    await this.assertMayChangeBoard(companyId, projectId, employeeId, role);

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
    // Every field, not only the name. Recolouring and repositioning a column
    // were open to anyone signed in, which made the rename check the only
    // thing anybody had to work around.
    await this.assertMayChangeBoard(companyId, projectId, employeeId, role);

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

  async deleteColumn(
    companyId: number, projectId: number, columnId: number,
    employeeId: number | null = null, role?: string,
  ) {
    await this.assertMayChangeBoard(companyId, projectId, employeeId, role);

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

  async unarchiveColumn(
    companyId: number, projectId: number, columnId: number,
    employeeId: number | null = null, role?: string,
  ) {
    await this.assertMayChangeBoard(companyId, projectId, employeeId, role);

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

  async reorderColumns(
    companyId: number, projectId: number, columnIds: number[],
    employeeId: number | null = null, role?: string,
  ) {
    await this.assertMayChangeBoard(companyId, projectId, employeeId, role);

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
