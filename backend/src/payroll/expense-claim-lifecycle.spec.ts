import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PayrollService } from './payroll.service';

/**
 * An expense claim's life after it is raised. Claims are reimbursed on their
 * own, not through salary.
 *
 *  - Finance roles and delegates on the EXPENSE_CLAIM list decide; nobody else,
 *    and nobody else can read the company's claims.
 *  - PAID is the end: nothing turns a paid claim back into anything else.
 *  - Approved and paid claims cannot be deleted.
 *  - Approvers hear about new claims; the claimant hears the decision.
 *  - Payroll neither reads nor touches claims.
 */
describe('PayrollService — expense claim lifecycle', () => {
  const COMPANY = 1;
  const APPROVER_USER = 100;
  const DELEGATE_USER = 200;
  const DELEGATE_EMPLOYEE = 20;
  const CLAIMANT = 7;

  let prisma: any;
  let approvals: any;
  let notifications: any;
  let service: PayrollService;
  let claim: any;

  beforeEach(() => {
    claim = { id: 5, companyId: COMPANY, employeeId: CLAIMANT, status: 'PENDING', amount: 1200, title: 'Cab', month: null, year: null, employee: { id: CLAIMANT } };
    prisma = {
      expenseClaim: {
        findFirst: jest.fn(async () => claim),
        findMany: jest.fn(async () => [claim]),
        create: jest.fn(async ({ data }) => ({ id: 9, ...data })),
        update: jest.fn(async ({ data }) => ({ ...claim, ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        delete: jest.fn(async () => claim),
      },
      employee: {
        findFirst: jest.fn(async ({ where }) => {
          if (where.userId === APPROVER_USER) return { id: 99 };
          if (where.userId === DELEGATE_USER) return { id: DELEGATE_EMPLOYEE };
          return { id: CLAIMANT, firstName: 'Asha', lastName: 'K' };
        }),
      },
      payslip: {
        findFirst: jest.fn(),
        findMany: jest.fn(async () => []),
        update: jest.fn(async ({ data }) => data),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      payslipItem: { findMany: jest.fn(async () => []) },
    };
    approvals = {
      mayApprove: jest.fn(async (_c, _w, _r, employeeId) => employeeId === DELEGATE_EMPLOYEE),
      approverEmployeeIds: jest.fn(async () => [DELEGATE_EMPLOYEE]),
    };
    notifications = {
      notifyEmployees: jest.fn(async (ids) => ids.length),
      notifyApprovers: jest.fn(async () => 0),
    };
    service = new PayrollService(prisma, {} as any, {} as any, approvals, notifications);
  });

  const decide = (status: string, user = APPROVER_USER, role = 'ADMIN') =>
    service.updateExpenseClaimStatus(COMPANY, user, claim.id, { status }, role);

  it('approves a pending claim and tells the claimant', async () => {
    await decide('APPROVED');
    expect(prisma.expenseClaim.update).toHaveBeenCalled();
    expect(notifications.notifyEmployees).toHaveBeenCalledWith([CLAIMANT], expect.objectContaining({ title: 'Expense claim approved' }));
  });

  it('lets a delegate on the Expense claims list decide', async () => {
    await decide('APPROVED', DELEGATE_USER, 'EMPLOYEE');
    expect(prisma.expenseClaim.update).toHaveBeenCalled();
  });

  it('refuses an employee who is neither finance nor a delegate', async () => {
    await expect(decide('APPROVED', 300, 'EMPLOYEE')).rejects.toThrow(ForbiddenException);
    expect(prisma.expenseClaim.update).not.toHaveBeenCalled();
  });

  it('keeps the company claim list to approvers', async () => {
    await expect(service.getAllExpenseClaims(COMPANY, 300, 'EMPLOYEE')).rejects.toThrow(ForbiddenException);
    await expect(service.getAllExpenseClaims(COMPANY, DELEGATE_USER, 'EMPLOYEE')).resolves.toHaveLength(1);
  });

  it('refuses any change to a paid claim', async () => {
    claim.status = 'PAID';
    for (const s of ['PENDING', 'APPROVED', 'REJECTED']) {
      await expect(decide(s)).rejects.toThrow(BadRequestException);
    }
    expect(prisma.expenseClaim.update).not.toHaveBeenCalled();
  });

  it('lets an approved claim be rejected until it is paid', async () => {
    Object.assign(claim, { status: 'APPROVED', month: 9, year: 2026 });
    await decide('REJECTED');
    expect(prisma.expenseClaim.update).toHaveBeenCalled();
  });

  it('refuses to send an approved claim back to pending', async () => {
    claim.status = 'APPROVED';
    await expect(decide('PENDING')).rejects.toThrow(BadRequestException);
  });

  it.each(['APPROVED', 'PAID'])('does not delete a %s claim, even for an admin', async (status) => {
    claim.status = status;
    await expect(service.deleteExpenseClaim(COMPANY, claim.id, APPROVER_USER, 'SUPERADMIN')).rejects.toThrow(BadRequestException);
    expect(prisma.expenseClaim.delete).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'REJECTED'])('lets the owner delete a %s claim', async (status) => {
    claim.status = status;
    await service.deleteExpenseClaim(COMPANY, claim.id, 1, 'EMPLOYEE');
    expect(prisma.expenseClaim.delete).toHaveBeenCalled();
  });

  it('tells the approvers when a claim is raised', async () => {
    await service.createExpenseClaim(COMPANY, 1, { title: 'Cab', amount: 1200 });
    expect(notifications.notifyEmployees).toHaveBeenCalledWith([DELEGATE_EMPLOYEE], expect.objectContaining({ title: 'New expense claim' }));
    expect(notifications.notifyApprovers).toHaveBeenCalledWith(expect.objectContaining({ roles: ['FINANCE'] }));
  });

  it('falls back to the admins when nobody else would hear of a claim', async () => {
    approvals.approverEmployeeIds.mockResolvedValue([]);
    await service.createExpenseClaim(COMPANY, 1, { title: 'Cab', amount: 1200 });
    expect(notifications.notifyApprovers).toHaveBeenCalledWith(expect.objectContaining({ roles: ['SUPERADMIN', 'ADMIN'] }));
  });

  it('does not touch claims when payslips are paid', async () => {
    await service.markPayslipsPaid(COMPANY, 9, 2026);
    expect(prisma.expenseClaim.updateMany).not.toHaveBeenCalled();
  });
});
