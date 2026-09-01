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

export interface ExpenseClaim {
  id: number;
  title: string;
  description?: string;
  amount: number;
  category: string;
  receiptUrl?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  purchaseDate?: string;
  purchasedFrom?: string;
  projectCode?: string;
  projectName?: string;
  createdAt: string;
  approvedBy?: {
    employee: {
      firstName: string;
      lastName: string;
    }
  };
}

export const payrollService = {
  getMyPayslips: async (): Promise<Payslip[]> => {
    const response = await apiClient.get('/payroll/payslips/me');
    return response.data;
  },

  getMyExpenseClaims: async (): Promise<ExpenseClaim[]> => {
    const response = await apiClient.get('/payroll/expenses/me');
    return response.data;
  },

  createExpenseClaim: async (data: any): Promise<ExpenseClaim> => {
    const response = await apiClient.post('/payroll/expenses', data);
    return response.data;
  },

  deleteExpenseClaim: async (id: number): Promise<void> => {
    await apiClient.delete(`/payroll/expenses/${id}`);
  },

  updateExpenseClaim: async (id: number, data: any): Promise<ExpenseClaim> => {
    const response = await apiClient.put(`/payroll/expenses/${id}`, data);
    return response.data;
  },
};
