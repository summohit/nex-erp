import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SalaryComponent {
  id: number;
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  isPreDefined: boolean;
  description?: string;
}

export interface SalaryStructureItem {
  id?: number;
  componentId: number;
  component: SalaryComponent;
  amount: number;
}

export interface EmployeeSalaryRow {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  employeeCode?: string;
  department?: { id?: number; name: string };
  designation?: { id?: number; name: string };
  user?: { email: string; role: string; status?: string };
  /** Drives the default order: longest-serving first. May be absent on older records. */
  joiningDate?: string | Date | null;
  salaryCycle: string;
  salaryGroup: string;
  allowPayrollGenerate: string;
  grossEarnings: number;
  totalDeductions: number;
  netSalary: number;
  hasStructure: boolean;
  salaryStructures?: SalaryStructureItem[];
}

export interface PayrollPreviewRow {
  employeeId: number;
  name: string;
  workingDays: number;
  presentDays: number;
  absences: number;
  gross: number;
  deductions: number;
  lossOfPay: number;
  net: number;
  noAttendance: boolean;
}

export interface PayrollPreview {
  month: number;
  year: number;
  employees: number;
  totalGross: number;
  totalLossOfPay: number;
  totalNet: number;
  /** 0–1. Anything material here means the attendance record, not the people. */
  lossOfPayShare: number;
  severelyAffected: number;
  noAttendance: number;
  rows: PayrollPreviewRow[];
}

export interface PayslipItem {
  id: number;
  componentName: string;
  type: string;
  amount: number;
}

export interface Payslip {
  id: number;
  employeeId: number;
  employee: {
    id: number;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
    department?: { name: string };
    designation?: { name: string };
    user?: { email?: string; role?: string; status?: string };
  };
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
  paidOn?: string;
  items: PayslipItem[];
}

export interface ExpenseClaim {
  id: number;
  employeeId?: number;
  employee?: {
    id: number;
    firstName: string;
    lastName: string;
    department?: { name: string };
    designation?: { name: string };
    avatarUrl?: string;
  };
  title: string;
  description?: string;
  amount: number;
  category: string;
  receiptUrl?: string;
  purchaseDate?: string;
  purchasedFrom?: string;
  projectCode?: string;
  projectName?: string;
  projectId?: number | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID' | string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt?: string;
  approvedBy?: {
    employee?: {
      firstName: string;
      lastName: string;
    };
  };
}

@Injectable({
  providedIn: 'root'
})
export class PayrollService {
  private apiUrl = `${environment.apiUrl}/payroll`;

  constructor(private http: HttpClient) {}

  // Salary Components
  getComponents(): Observable<SalaryComponent[]> {
    return this.http.get<SalaryComponent[]>(`${this.apiUrl}/components`);
  }

  createComponent(data: { name: string; type: string; description?: string }): Observable<SalaryComponent> {
    return this.http.post<SalaryComponent>(`${this.apiUrl}/components`, data);
  }

  updateComponent(id: number, data: { name?: string; description?: string }): Observable<SalaryComponent> {
    return this.http.put<SalaryComponent>(`${this.apiUrl}/components/${id}`, data);
  }

  deleteComponent(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/components/${id}`);
  }

  // Salary Structure
  getAllSalaryStructures(): Observable<EmployeeSalaryRow[]> {
    return this.http.get<EmployeeSalaryRow[]>(`${this.apiUrl}/structures`);
  }

  /** Take an employee off payroll, or put them back on. */
  setAllowPayrollGenerate(employeeId: number, allow: boolean): Observable<any> {
    return this.http.put(`${this.apiUrl}/structure/${employeeId}/allow-payroll`, { allow });
  }

  getSalaryStructure(employeeId: number): Observable<SalaryStructureItem[]> {
    return this.http.get<SalaryStructureItem[]>(`${this.apiUrl}/structure/${employeeId}`);
  }

  updateSalaryStructure(employeeId: number, items: { componentId: number; amount: number }[]): Observable<SalaryStructureItem[]> {
    return this.http.post<SalaryStructureItem[]>(`${this.apiUrl}/structure/${employeeId}`, items);
  }

  // Payslips
  generatePayslips(month: number, year: number, skipLossOfPay = false): Observable<Payslip[]> {
    return this.http.post<Payslip[]>(`${this.apiUrl}/payslips/generate`, { month, year, skipLossOfPay });
  }

  /** What a run would pay, before it is run. Writes nothing. */
  previewPayroll(month: number, year: number): Observable<PayrollPreview> {
    let params = new HttpParams().set('month', String(month)).set('year', String(year));
    return this.http.get<PayrollPreview>(`${this.apiUrl}/payslips/preview`, { params });
  }

  sendPayslipEmails(month: number, year: number): Observable<{ message: string; sentCount: number; failedCount: number; totalCount: number }> {
    return this.http.post<{ message: string; sentCount: number; failedCount: number; totalCount: number }>(
      `${this.apiUrl}/payslips/send-emails`,
      { month, year }
    );
  }

  getPayslips(month?: number, year?: number): Observable<Payslip[]> {
    let params = new HttpParams();
    if (month) params = params.set('month', month.toString());
    if (year) params = params.set('year', year.toString());
    return this.http.get<Payslip[]>(`${this.apiUrl}/payslips`, { params });
  }

  getMyPayslips(): Observable<Payslip[]> {
    return this.http.get<Payslip[]>(`${this.apiUrl}/payslips/me`);
  }

  updatePayslip(id: number, data: { lossOfPay?: number; totalEarnings?: number; totalDeductions?: number; expenseAmount?: number; status?: string }): Observable<Payslip> {
    return this.http.put<Payslip>(`${this.apiUrl}/payslips/${id}`, data);
  }

  /** Rewrite a payslip from its component lines; totals are derived server-side. */
  updatePayslipItems(
    id: number,
    body: {
      items: { componentName: string; type: string; amount: number }[];
      workingDays?: number;
      presentDays?: number;
    },
  ): Observable<Payslip> {
    return this.http.put<Payslip>(`${this.apiUrl}/payslips/${id}/items`, body);
  }

  getPayslipDetail(id: number): Observable<Payslip> {
    return this.http.get<Payslip>(`${this.apiUrl}/payslips/${id}/detail`);
  }

  /** The PDF itself, so the caller can save it rather than open a tab. */
  downloadPayslip(id: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/payslips/${id}/pdf`, { responseType: 'blob' });
  }

  /** Re-send one person's payslip, without mailing everybody again. */
  sendOnePayslipEmail(id: number): Observable<{ sent: boolean; email: string }> {
    return this.http.post<{ sent: boolean; email: string }>(
      `${this.apiUrl}/payslips/${id}/send-email`, {});
  }

  batchFinalizePayslips(month: number, year: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/payslips/finalize-all`, { month, year });
  }

  markPayslipsPaid(month: number, year: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/payslips/mark-paid`, { month, year });
  }

  // Expense Claims
  createExpenseClaim(data: { title: string; description?: string; amount: number; category?: string; receiptUrl?: string; purchaseDate?: string; purchasedFrom?: string; projectCode?: string; projectName?: string; projectId?: number }): Observable<ExpenseClaim> {
    return this.http.post<ExpenseClaim>(`${this.apiUrl}/expenses`, data);
  }

  uploadFile(file: File): Observable<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ url: string }>(`${environment.apiUrl}/upload`, formData);
  }

  getMyExpenseClaims(): Observable<ExpenseClaim[]> {
    return this.http.get<ExpenseClaim[]>(`${this.apiUrl}/expenses/me`);
  }

  getAllExpenseClaims(): Observable<ExpenseClaim[]> {
    return this.http.get<ExpenseClaim[]>(`${this.apiUrl}/expenses`);
  }

  updateExpenseClaimStatus(id: number, data: { status: string; rejectionReason?: string }): Observable<ExpenseClaim> {
    return this.http.put<ExpenseClaim>(`${this.apiUrl}/expenses/${id}/status`, data);
  }

  deleteExpenseClaim(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/expenses/${id}`);
  }
}
