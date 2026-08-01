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
}
