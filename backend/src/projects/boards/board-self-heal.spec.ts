import { NotFoundException } from '@nestjs/common';
import { BoardsService } from './boards.service';

/**
 * A project with no board (duplicated without one) gets the standard board
 * when it is opened, instead of a 404 and an empty screen.
 */
describe('opening a project that has no board', () => {
  const columns = [{ id: 501 }, { id: 502 }];
  const make = (projectExists: boolean) => {
    const tx: any = {
      board: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({ id: 9, columns })) },
      issue: { updateMany: jest.fn(async () => ({ count: 5 })) },
    };
    let calls = 0;
    const prisma: any = {
      board: { findFirst: jest.fn(async () => (calls++ === 0 ? null : { id: 9, columns })) },
      project: { findFirst: jest.fn(async () => (projectExists ? { id: 105 } : null)) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    return { service: Object.assign(Object.create(BoardsService.prototype), { prisma }) as BoardsService, prisma, tx };
  };

  it('creates the standard board and puts column-less tasks in To Do', async () => {
    const { service, tx } = make(true);
    const board: any = await service.getBoard(1, 105);
    expect(board.id).toBe(9);
    expect(tx.board.create.mock.calls[0][0].data.columns.create.map((c: any) => c.name))
      .toEqual(['To Do', 'In Progress', 'In Review', 'Done', 'Archived']);
    expect(tx.issue.updateMany).toHaveBeenCalledWith({ where: { projectId: 105, columnId: null }, data: { columnId: 501 } });
  });

  it('still refuses a project that is not this company\'s', async () => {
    const { service, tx } = make(false);
    await expect(service.getBoard(1, 999)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.board.create).not.toHaveBeenCalled();
  });
});
