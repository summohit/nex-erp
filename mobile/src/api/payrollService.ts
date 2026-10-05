import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { apiClient, API_URL } from './apiClient';
import { useAuthStore } from '../store/authStore';

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
    employeeCode?: string | null;
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

/**
 * The same server-rendered PDF the web "Download PDF" button gets, written to
 * the phone and opened in its PDF viewer. On Android a copy also lands in
 * Downloads so it can be found (or forwarded) later.
 *
 * Fetched outside axios because a PDF has to go to a file, not into memory as
 * JSON — so the 401 refresh the API client normally does is done by hand: on
 * an expired token, one cheap axios call lets the interceptor mint a new one,
 * then the download is tried once more.
 */
async function downloadPayslipPdf(id: number, fileName: string): Promise<void> {
  const { dirs } = ReactNativeBlobUtil.fs;
  const path = `${dirs.CacheDir}/${fileName}`;

  const fetchOnce = () =>
    ReactNativeBlobUtil.config({ path, overwrite: true }).fetch(
      'GET',
      `${API_URL}/payroll/payslips/${id}/pdf`,
      {
        Authorization: `Bearer ${useAuthStore.getState().token ?? ''}`,
        'X-Client-Platform': 'mobile',
      },
    );

  let res = await fetchOnce();
  if (res.info().status === 401) {
    await apiClient.get('/payroll/payslips/me');
    res = await fetchOnce();
  }
  if (res.info().status !== 200) {
    await ReactNativeBlobUtil.fs.unlink(path).catch(() => {});
    throw new Error('Could not download the payslip. Please try again.');
  }

  if (Platform.OS === 'android') {
    try {
      await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
        { name: fileName, parentFolder: '', mimeType: 'application/pdf' },
        'Download',
        path,
      );
    } catch {
      // Still opens below; a missing copy in Downloads is not worth failing over.
    }
    await ReactNativeBlobUtil.android.actionViewIntent(path, 'application/pdf');
  } else {
    await ReactNativeBlobUtil.ios.openDocument(path);
  }
}

export const payrollService = {
  downloadPayslipPdf,

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
