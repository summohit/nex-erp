import { PayrollService } from './payroll.service';

describe('PayrollService employee payslip visibility', () => {
  const detailService = (findFirst: jest.Mock) => {
    const service = Object.create(PayrollService.prototype) as PayrollService;
    (service as any).prisma = { payslip: { findFirst } };
    return service;
  };

  it('does not let an employee open a draft by its direct detail URL', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = detailService(findFirst);

    await expect(service.getPayslipDetail(1, 9, 60)).rejects.toThrow('Payslip not found');
    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      id: 9,
      companyId: 1,
      employeeId: 60,
      status: { in: ['FINALIZED', 'PAID'] },
    });
  });

  it('leaves the payroll operator view unfiltered', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 9, status: 'DRAFT' });
    const service = detailService(findFirst);

    await expect(service.getPayslipDetail(1, 9)).resolves.toMatchObject({ status: 'DRAFT' });
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 9, companyId: 1 });
  });
});
