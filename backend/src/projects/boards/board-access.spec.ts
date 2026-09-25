import { ForbiddenException } from '@nestjs/common';
import { BoardsService } from './boards.service';

/**
 * The columns are the board, so changing them is the same standing as
 * changing the work on it.
 *
 * Three of these had no check at all: deleting a column, reordering them and
 * restoring an archived one were reachable by any signed-in employee, on any
 * project in the company. Hiding the menu in the browser did nothing about it.
 */
describe('who may change a board', () => {
  function make(opts: { leadId?: number; memberRole?: string | null } = {}) {
    const { leadId = 70, memberRole = null } = opts;
    const prisma: any = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: 3, leadId }) },
      projectMember: {
        findFirst: jest.fn().mockResolvedValue(memberRole ? { role: memberRole } : null),
      },
      board: { findFirst: jest.fn().mockResolvedValue({ id: 5 }) },
      boardColumn: {
        findFirst: jest.fn().mockResolvedValue({ id: 10, boardId: 5, isSystem: false }),
        update: jest.fn().mockResolvedValue({ id: 10 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(3),
        create: jest.fn().mockResolvedValue({ id: 11 }),
      },
      $transaction: jest.fn().mockImplementation((arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg)),
    };
    return { service: new BoardsService(prisma), prisma };
  }

  const MEMBER = { memberRole: 'MEMBER' };
  const ARCHITECT = { memberRole: 'TECHNICAL_ARCHITECT' };

  describe('deleting a column', () => {
    it('is refused for a plain member', async () => {
      const { service } = make(MEMBER);
      await expect(service.deleteColumn(1, 3, 10, 60, 'EMPLOYEE'))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is refused for a technical architect', async () => {
      const { service } = make(ARCHITECT);
      await expect(service.deleteColumn(1, 3, 10, 60, 'EMPLOYEE'))
        .rejects.toThrow(/Only the project owner, a project manager or an administrator/);
    });

    it('is allowed for the owner', async () => {
      const { service } = make({ leadId: 60 });
      await expect(service.deleteColumn(1, 3, 10, 60, 'EMPLOYEE')).resolves.toBeDefined();
    });

    it('is allowed for a project manager', async () => {
      const { service } = make({ memberRole: 'PROJECT_MANAGER' });
      await expect(service.deleteColumn(1, 3, 10, 60, 'EMPLOYEE')).resolves.toBeDefined();
    });

    it('is allowed for a company administrator', async () => {
      const { service } = make(MEMBER);
      await expect(service.deleteColumn(1, 3, 10, 60, 'ADMIN')).resolves.toBeDefined();
    });
  });

  describe('the other ways to reshape a board', () => {
    it('refuses a reorder from a member', async () => {
      const { service } = make(MEMBER);
      await expect(service.reorderColumns(1, 3, [10, 11], 60, 'EMPLOYEE'))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses restoring an archived column', async () => {
      const { service } = make(MEMBER);
      await expect(service.unarchiveColumn(1, 3, 10, 60, 'EMPLOYEE'))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a recolour, which used to be open to everyone', async () => {
      // Only renaming was checked before, so colour and position were a way
      // round the one rule that existed.
      const { service } = make(MEMBER);
      await expect(service.updateColumn(1, 3, 10, { color: '#ff0000' }, 60, 'EMPLOYEE'))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses creating a column', async () => {
      const { service } = make(MEMBER);
      await expect(service.createColumn(1, 3, { name: 'QA' }, 60, 'EMPLOYEE'))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
