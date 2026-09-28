import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { APPROVAL_WORKFLOW } from './approval-workflows';

describe('approval delegation (§Att5, §PB7, §PB8)', () => {
  const make = (delegate: any = null) => {
    const prisma = {
      approvalDelegate: {
        findFirst: jest.fn(async () => delegate),
        findMany: jest.fn(async () => (delegate ? [delegate] : [])),
        upsert: jest.fn(async (args: any) => ({ id: 1, ...args.create })),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      employee: { findFirst: jest.fn(async (): Promise<{ id: number } | null> => ({ id: 42 })) },
    };
    return { svc: new ApprovalsService(prisma as any), prisma };
  };

  describe('who may approve', () => {
    it('lets the company owner approve without being in the table', async () => {
      const { svc, prisma } = make(null);
      await expect(svc.mayApprove(1, APPROVAL_WORKFLOW.CLOCK_OUT, 'SUPERADMIN', null)).resolves.toBe(true);
      // The point: no lookup is needed, so no edit to the table can lock them out.
      expect(prisma.approvalDelegate.findFirst).not.toHaveBeenCalled();
    });

    it('lets a delegate approve', async () => {
      const { svc } = make({ id: 9 });
      await expect(svc.mayApprove(1, APPROVAL_WORKFLOW.CLOCK_OUT, 'EMPLOYEE', 42)).resolves.toBe(true);
    });

    it('refuses somebody nobody put on the queue', async () => {
      const { svc } = make(null);
      await expect(svc.mayApprove(1, APPROVAL_WORKFLOW.CLOCK_OUT, 'EMPLOYEE', 42)).resolves.toBe(false);
    });

    /** Being an admin is not the same as being on this queue. */
    it('does not admit a plain ADMIN by role alone', async () => {
      const { svc } = make(null);
      await expect(svc.mayApprove(1, APPROVAL_WORKFLOW.CLOCK_OUT, 'ADMIN', 7)).resolves.toBe(false);
    });

    it('refuses a caller with no employee record', async () => {
      const { svc } = make({ id: 9 });
      await expect(svc.mayApprove(1, APPROVAL_WORKFLOW.CLOCK_OUT, 'EMPLOYEE', null)).resolves.toBe(false);
    });
  });

  describe('granting and revoking', () => {
    it('is the company owner\'s alone', async () => {
      const { svc, prisma } = make();
      await expect(svc.grant(1, APPROVAL_WORKFLOW.TASK, 42, 'ADMIN', 1)).rejects.toThrow(ForbiddenException);
      await expect(svc.revoke(1, APPROVAL_WORKFLOW.TASK, 42, 'ADMIN')).rejects.toThrow(ForbiddenException);
      expect(prisma.approvalDelegate.upsert).not.toHaveBeenCalled();
      expect(prisma.approvalDelegate.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects a workflow that does not exist', async () => {
      const { svc } = make();
      await expect(svc.grant(1, 'WHATEVER', 42, 'SUPERADMIN', 1)).rejects.toThrow(BadRequestException);
    });

    it('will not delegate to somebody outside the company', async () => {
      const { svc, prisma } = make();
      prisma.employee.findFirst = jest.fn(async () => null);
      await expect(svc.grant(1, APPROVAL_WORKFLOW.TASK, 999, 'SUPERADMIN', 1)).rejects.toThrow(NotFoundException);
    });

    /** Granting twice is the same state; it should not be an error to read. */
    it('is idempotent', async () => {
      const { svc, prisma } = make();
      await svc.grant(1, APPROVAL_WORKFLOW.TASK, 42, 'SUPERADMIN', 1);
      expect(prisma.approvalDelegate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: {} }),
      );
    });
  });

  describe('who gets notified', () => {
    /**
     * Delegates only. A Super Admin can approve anything in the company, and
     * notifying all of them about every forgotten clock-out is a broadcast,
     * not a queue.
     */
    it('returns the delegates, and nobody else', async () => {
      const { svc } = make({ employeeId: 42 });
      await expect(svc.approverEmployeeIds(1, APPROVAL_WORKFLOW.CLOCK_OUT)).resolves.toEqual([42]);
    });

    it('returns nothing when nobody has been delegated', async () => {
      const { svc } = make(null);
      await expect(svc.approverEmployeeIds(1, APPROVAL_WORKFLOW.CLOCK_OUT)).resolves.toEqual([]);
    });
  });
});
