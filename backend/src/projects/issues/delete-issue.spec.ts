import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { IssuesService } from './issues.service';

/**
 * Deleting a task is the one irreversible thing the board can do, so the rules
 * around it are worth pinning: who may, and what stops them.
 */
describe('deleting a task (§PB4)', () => {
  const make = (issue: any = null) => {
    const del = jest.fn(async () => ({}));
    const prisma = { issue: { findFirst: jest.fn(async () => issue), delete: del } };
    const gateway = { emitIssueUpdated: jest.fn(), emitActivityAdded: jest.fn() };
    const svc = new IssuesService(prisma as any, gateway as any, null as any, null as any);
    return { svc, prisma, del };
  };

  const task = (timeLogs = 0) => ({
    id: 7, key: 'NEX-7', title: 'Wire the thing', _count: { timeLogs },
  });

  it('refuses anyone who is not a Super Admin', async () => {
    const { svc, del } = make(task());
    await expect(svc.deleteIssue(1, 2, 7, 'ADMIN')).rejects.toThrow(ForbiddenException);
    await expect(svc.deleteIssue(1, 2, 7, 'EMPLOYEE')).rejects.toThrow(ForbiddenException);
    await expect(svc.deleteIssue(1, 2, 7, undefined)).rejects.toThrow(ForbiddenException);
    expect(del).not.toHaveBeenCalled();
  });

  it('accepts the spelling older tokens carry', async () => {
    const { svc, del } = make(task());
    await svc.deleteIssue(1, 2, 7, 'SUPER_ADMIN');
    expect(del).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it('deletes a task nobody has logged time against', async () => {
    const { svc, del } = make(task(0));
    const out = await svc.deleteIssue(1, 2, 7, 'SUPERADMIN');
    expect(del).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(out).toMatchObject({ deleted: true, key: 'NEX-7' });
  });

  /**
   * The point of the whole guard: IssueTimeLog cascades, and the timesheet
   * service reads those rows, so this delete would edit weeks people have
   * already submitted.
   */
  it('refuses a task carrying time logs, and says to archive instead', async () => {
    const { svc, del } = make(task(3));
    await expect(svc.deleteIssue(1, 2, 7, 'SUPERADMIN')).rejects.toThrow(BadRequestException);
    await expect(svc.deleteIssue(1, 2, 7, 'SUPERADMIN')).rejects.toThrow(/Archive the task instead/);
    expect(del).not.toHaveBeenCalled();
  });

  it('does not reach outside the caller\'s company or project', async () => {
    const { svc, prisma } = make(null);
    await expect(svc.deleteIssue(1, 2, 7, 'SUPERADMIN')).rejects.toThrow(NotFoundException);
    expect(prisma.issue.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, projectId: 2, companyId: 1 } }),
    );
  });
});
