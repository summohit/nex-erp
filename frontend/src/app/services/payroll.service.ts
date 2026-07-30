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
    department?: { name: string };
    designation?: { name: string };
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
  employeeId: number;
  employee?: {
    id: number;
    firstName: string;
    lastName: string;
    department?: { name: string };
  };
  title: string;
  description?: string;
  amount: number;
  category: string;
  receiptUrl?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  createdAt: string;
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
  getSalaryStructure(employeeId: number): Observable<SalaryStructureItem[]> {
    return this.http.get<SalaryStructureItem[]>(`${this.apiUrl}/structure/${employeeId}`);
  }

  updateSalaryStructure(employeeId: number, items: { componentId: number; amount: number }[]): Observable<SalaryStructureItem[]> {
    return this.http.post<SalaryStructureItem[]>(`${this.apiUrl}/structure/${employeeId}`, items);
  }

  // Payslips
  generatePayslips(month: number, year: number): Observable<Payslip[]> {
    return this.http.post<Payslip[]>(`${this.apiUrl}/payslips/generate`, { month, year });
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

  batchFinalizePayslips(month: number, year: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/payslips/finalize-all`, { month, year });
  }

  markPayslipsPaid(month: number, year: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/payslips/mark-paid`, { month, year });
  }

  // Expense Claims
  createExpenseClaim(data: { title: string; description?: string; amount: number; category?: string; receiptUrl?: string }): Observable<ExpenseClaim> {
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
