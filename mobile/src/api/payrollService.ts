import { apiClient } from './apiClient';

export interface PayslipItem {
  id: number;
  componentName: string;
  type: 'EARNING' | 'DEDUCTION' | 'EXPENSE';
  amount: number;
}

export interface Payslip {
  id: number;
  month: number;
  year: number;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  totalEarnings: number;
  totalDeductions: number;
  lossOfPay: number;
  expenseAmount: number;
  netPay: number;
  status: 'DRAFT' | 'FINALIZED' | 'PAID';
  paidOn?: string | null;
  items: PayslipItem[];
  employee: {
    firstName: string;
    lastName: string;
    department?: { name: string } | null;
    designation?: { name: string } | null;
  };
}

export const payrollService = {
  getMyPayslips: async (): Promise<Payslip[]> => {
    const response = await apiClient.get('/payroll/payslips/me');
    return response.data;
  },
};
