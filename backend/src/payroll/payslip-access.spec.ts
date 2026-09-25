import { ForbiddenException } from '@nestjs/common';
import { PayrollController } from './payroll.controller';

/**
 * A payslip is somebody's salary.
 *
 * Every one of these endpoints was reachable by any signed-in employee: the
 * screen hid the Edit and Send Again buttons from them, and nothing else did.
 * An employee could rewrite the amounts on a payslip, mark one paid, re-send
 * it by email, or read every colleague's pay by walking the id in the URL.
 */
describe('who may act on a payslip', () => {
  const service: any = {
    updatePayslip: jest.fn().mockResolvedValue({}),
    updatePayslipItems: jest.fn().mockResolvedValue({}),
    sendOnePayslipEmail: jest.fn().mockResolvedValue({}),
    markPayslipsPaid: jest.fn().mockResolvedValue({}),
    batchFinalizePayslips: jest.fn().mockResolvedValue({}),
    batchSendPayslipEmails: jest.fn().mockResolvedValue({}),
    generatePayslips: jest.fn().mockResolvedValue({}),
    getPayslips: jest.fn().mockResolvedValue([]),
    getPayslipDetail: jest.fn().mockResolvedValue({}),
    getPayslipPdf: jest.fn().mockResolvedValue({ buffer: Buffer.from(''), isPdf: true, filename: 'p.pdf' }),
  };
  const controller = new PayrollController(service);

  const as = (role: string, employeeId = 60) => ({ user: { role, companyId: 1, employeeId, sub: 5 } });

  beforeEach(() => jest.clearAllMocks());

  describe('an ordinary employee', () => {
    it('cannot edit the amounts on a payslip', () => {
      expect(() => controller.updatePayslip(as('EMPLOYEE'), 9, { lossOfPay: 0 }))
        .toThrow(ForbiddenException);
      expect(service.updatePayslip).not.toHaveBeenCalled();
    });

    it('cannot rewrite its line items', () => {
      expect(() => controller.updatePayslipItems(as('EMPLOYEE'), 9, { items: [] }))
        .toThrow(/Only payroll administrators/);
    });

    it('cannot send it again', () => {
      expect(() => controller.sendOnePayslipEmail(as('EMPLOYEE'), 9))
        .toThrow(/Only payroll administrators can send a payslip/);
    });

    it('cannot mark payslips paid, finalise them, or run a batch send', () => {
      expect(() => controller.markPayslipsPaid(as('EMPLOYEE'), { month: 8, year: 2026 })).toThrow(ForbiddenException);
      expect(() => controller.batchFinalizePayslips(as('EMPLOYEE'), { month: 8, year: 2026 })).toThrow(ForbiddenException);
      expect(() => controller.batchSendEmails(as('EMPLOYEE'), { month: 8, year: 2026 })).toThrow(ForbiddenException);
    });

    it('cannot browse the whole company payroll', () => {
      expect(() => controller.getPayslips(as('EMPLOYEE'), 8, 2026)).toThrow(ForbiddenException);
    });

    it('reads a payslip only if it is their own', async () => {
      await controller.getPayslipDetail(as('EMPLOYEE', 60), 9);
      // The employee id goes into the query, so another person's id in the URL
      // matches nothing rather than returning their salary.
      expect(service.getPayslipDetail).toHaveBeenCalledWith(1, 9, 60);
    });

    it('is scoped on the PDF too, which is the same data', async () => {
      await controller.downloadPayslip(as('EMPLOYEE', 60), 9, { set: jest.fn(), end: jest.fn() });
      expect(service.getPayslipPdf).toHaveBeenCalledWith(1, 9, 60);
    });

    it('is refused rather than unscoped when the login has no employee record', async () => {
      await controller.getPayslipDetail({ user: { role: 'EMPLOYEE', companyId: 1 } }, 9);
      // -1 matches nobody. Falling back to "no scope" would have opened it up.
      expect(service.getPayslipDetail).toHaveBeenCalledWith(1, 9, -1);
    });
  });

  describe('the people who run payroll', () => {
    it.each(['SUPERADMIN', 'ADMIN', 'HR', 'FINANCE'])('lets %s edit', (role) => {
      expect(() => controller.updatePayslip(as(role), 9, { lossOfPay: 0 })).not.toThrow();
      expect(service.updatePayslip).toHaveBeenCalled();
    });

    it('reads anybody\'s payslip without a scope', async () => {
      await controller.getPayslipDetail(as('HR'), 9);
      expect(service.getPayslipDetail).toHaveBeenCalledWith(1, 9, null);
    });
  });
});
