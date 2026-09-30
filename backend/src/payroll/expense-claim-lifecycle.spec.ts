import { BadRequestException } from '@nestjs/common';
import { PayrollService } from './payroll.service';

/**
 * An expense claim's life after it is raised.
 *
 *  - PAID is the end: nothing turns a paid claim back into anything else.
 *  - An approved claim can be withdrawn only until payroll puts it on a payslip.
 *  - Approved and paid claims cannot be deleted.
 *  - Paying a payslip pays the claims it reimbursed.
 */
describe('PayrollService — expense claim lifecycle', () => {
  const COMPANY = 1;
  const APPROVER_USER = 100;
  const CLAIMANT = 7;

  let prisma: any;
  let service: PayrollService;
  let claim: any;

  beforeEach(() => {
    claim = { id: 5, companyId: COMPANY, employeeId: CLAIMANT, status: 'PENDING', month: null, year: null, employee: { id: CLAIMANT } };
    prisma = {
      expenseClaim: {
        findFirst: jest.fn(async () => claim),
        update: jest.fn(async ({ data }) => ({ ...claim, ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        delete: jest.fn(async () => claim),
      },
      employee: {
        // The approver is someone else; the claimant owns the claim.
        findFirst: jest.fn(async ({ where }) => ({ id: where.userId === APPROVER_USER ? 99 : CLAIMANT })),
      },
      payslip: {
        findFirst: jest.fn(),
        findMany: jest.fn(async () => [{ employeeId: CLAIMANT }]),
        update: jest.fn(async ({ data }) => data),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      payslipItem: { findMany: jest.fn(async () => []) },
    };
    service = new PayrollService(prisma, {} as any, {} as any);
  });

  const decide = (status: string) =>
    service.updateExpenseClaimStatus(COMPANY, APPROVER_USER, claim.id, { status }, 'ADMIN');

  it('approves a pending claim', async () => {
    await decide('APPROVED');
    expect(prisma.expenseClaim.update).toHaveBeenCalled();
  });

  it('refuses any change to a paid claim', async () => {
    claim.status = 'PAID';
    for (const s of ['PENDING', 'APPROVED', 'REJECTED']) {
      await expect(decide(s)).rejects.toThrow(BadRequestException);
    }
    expect(prisma.expenseClaim.update).not.toHaveBeenCalled();
  });

  it('lets an approved claim be rejected before payroll picks it up', async () => {
    claim.status = 'APPROVED';
    await decide('REJECTED');
    expect(prisma.expenseClaim.update).toHaveBeenCalled();
  });

  it('refuses to reject an approved claim already on a payslip', async () => {
    Object.assign(claim, { status: 'APPROVED', month: 9, year: 2026 });
    await expect(decide('REJECTED')).rejects.toThrow(/payslip/);
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

  it('marks the month\'s approved claims paid when payslips are paid', async () => {
    await service.markPayslipsPaid(COMPANY, 9, 2026);
    expect(prisma.expenseClaim.updateMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY, employeeId: { in: [CLAIMANT] }, month: 9, year: 2026, status: 'APPROVED' },
      data: { status: 'PAID' },
    });
  });

  it('marks claims paid when a single payslip is set to PAID', async () => {
    prisma.payslip.findFirst.mockResolvedValue({ id: 3, companyId: COMPANY, employeeId: CLAIMANT, month: 9, year: 2026, status: 'FINALIZED', lossOfPay: 0, totalEarnings: 0, totalDeductions: 0, expenseAmount: 0 });
    await service.updatePayslip(COMPANY, 3, { status: 'PAID' });
    expect(prisma.expenseClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ employeeId: { in: [CLAIMANT] }, month: 9, year: 2026, status: 'APPROVED' }),
    }));
  });
});
