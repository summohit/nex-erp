import { Test, TestingModule } from '@nestjs/testing';
import { PayrollMastersService } from './payroll-masters.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PayrollMastersService', () => {
  let service: PayrollMastersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      payrollComponent: {
        findMany: jest.fn().mockResolvedValue([
          { code: 'BASIC', name: 'Basic Salary', category: 'EARNING', displayOrder: 10 },
          { code: 'HRA', name: 'HRA', category: 'EARNING', displayOrder: 20 },
          { code: 'EMPLOYER_PF', name: 'Employer PF', category: 'EMPLOYER_CONTRIBUTION', showOnPayslip: false },
        ]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      payrollSalaryGroup: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      payrollStatutoryRate: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
      payrollTaxRegime: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      payrollAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollMastersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PayrollMastersService>(PayrollMastersService);
  });

  describe('validateFormula', () => {
    it('validates a valid formula and computes sample output', async () => {
      const res = await service.validateFormula(1, 'BASIC * 0.4', 600000);
      expect(res.valid).toBe(true);
      expect(res.variables).toEqual(['BASIC']);
      expect(res.sampleResult).toBe(10000); // 50,000 * 0.5 = 25,000 Basic * 0.4 = 10,000
    });

    it('rejects formulas with unknown variables', async () => {
      const res = await service.validateFormula(1, 'NON_EXISTENT_COMPONENT * 0.4');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('unknown variables: NON_EXISTENT_COMPONENT');
    });

    it('handles syntax errors gracefully', async () => {
      const res = await service.validateFormula(1, 'BASIC * +');
      expect(res.valid).toBe(false);
      expect(res.error).toBeDefined();
    });
  });

  describe('createComponent', () => {
    it('ensures employer contributions default to showOnPayslip: false', async () => {
      prisma.payrollComponent.findUnique.mockResolvedValue(null);
      prisma.payrollComponent.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data }));

      const res = await service.createComponent(1, {
        code: 'EMPLOYER_SPECIAL',
        name: 'Employer Special',
        category: 'EMPLOYER_CONTRIBUTION',
      });

      expect(res.showOnPayslip).toBe(false);
      expect(prisma.payrollComponent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            code: 'EMPLOYER_SPECIAL',
            category: 'EMPLOYER_CONTRIBUTION',
            showOnPayslip: false,
          }),
        }),
      );
    });
  });
});
