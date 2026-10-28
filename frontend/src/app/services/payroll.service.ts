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
  /** EMPLOYEE is graded and on the template; CONSULTANT is contract pay, outside both. */
  payType?: 'EMPLOYEE' | 'CONSULTANT';
  /** Read from the gross by the server; null for consultants and anyone unpaid. */
  grade?: { id: number; name: string; label?: string | null } | null;
}

/** A pay band by monthly gross. maxGross null = no ceiling (the top grade). */
export interface SalaryGrade {
  id?: number;
  name: string;
  label?: string | null;
  minGross: number;
  maxGross: number | null;
  /** Field visit travel: ₹ per km for own-vehicle trips. Null = vehicle default. */
  kmRate?: number | null;
}

/** How a monthly gross splits into components. */
export interface SalaryTemplateRules {
  basicPct: number;
  hraPctOfBasic: number;
  conveyance: number;
  medical: number;
  pfPct: number;
  pfWageCap: number | null;
  esiPct: number;
  esiGrossLimit: number;
  professionalTax: number;
}

export interface TemplatePreview {
  gross: number;
  net: number;
  grade: { id: number; name: string; label?: string | null } | null;
  lines: {
    line: string;
    type: 'EARNING' | 'DEDUCTION';
    amount: number;
    component: { id: number | null; name: string };
  }[];
  current: { componentId: number; name?: string; type?: string; amount: number }[];
  currentGross: number;
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

  updatePayslip(id: number, data: { lossOfPay?: number; totalEarnings?: number; totalDeductions?: number; expenseAmount?: number; status?: string; paidOn?: string }): Observable<Payslip> {
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

  markPayslipsPaid(month: number, year: number, paidOn?: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/payslips/mark-paid`, { month, year, paidOn });
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

  // ── Grades & salary template ──────────────────────────────────────────────

  getSalaryGrades(): Observable<SalaryGrade[]> {
    return this.http.get<SalaryGrade[]>(`${this.apiUrl}/grades`);
  }

  saveSalaryGrades(grades: SalaryGrade[]): Observable<SalaryGrade[]> {
    return this.http.put<SalaryGrade[]>(`${this.apiUrl}/grades`, grades);
  }

  /** Per-km travel rate for interns and consultants (outside grades). */
  getUngradedKmRate(): Observable<{ ungradedKmRate: number | null }> {
    return this.http.get<{ ungradedKmRate: number | null }>(`${this.apiUrl}/grades/ungraded-km-rate`);
  }

  setUngradedKmRate(ungradedKmRate: number | null): Observable<{ ungradedKmRate: number | null }> {
    return this.http.put<{ ungradedKmRate: number | null }>(`${this.apiUrl}/grades/ungraded-km-rate`, { ungradedKmRate });
  }

  getSalaryTemplate(): Observable<SalaryTemplateRules> {
    return this.http.get<SalaryTemplateRules>(`${this.apiUrl}/template`);
  }

  updateSalaryTemplate(rules: Partial<SalaryTemplateRules>): Observable<SalaryTemplateRules> {
    return this.http.put<SalaryTemplateRules>(`${this.apiUrl}/template`, rules);
  }

  setPayType(employeeId: number, payType: 'EMPLOYEE' | 'CONSULTANT'): Observable<{ id: number; payType: string }> {
    return this.http.put<{ id: number; payType: string }>(`${this.apiUrl}/structure/${employeeId}/pay-type`, { payType });
  }

  previewSalaryTemplate(employeeId: number, gross?: number | null): Observable<TemplatePreview> {
    const qs = gross ? `?gross=${gross}` : '';
    return this.http.get<TemplatePreview>(`${this.apiUrl}/structure/${employeeId}/template-preview${qs}`);
  }

  applySalaryTemplate(employeeId: number, gross: number): Observable<SalaryStructureItem[]> {
    return this.http.post<SalaryStructureItem[]>(`${this.apiUrl}/structure/${employeeId}/apply-template`, { gross });
  }

  /** Finance roles, plus anyone on the Expense claims list in Settings → Approvals. */
  canApproveExpenseClaims(): Observable<{ canApprove: boolean }> {
    return this.http.get<{ canApprove: boolean }>(`${this.apiUrl}/expenses/can-approve`);
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

  // ── Configurable Payroll Masters & Engine (Phase 1 & 2) ───────────────────

  getPayrollComponents(): Observable<MasterComponent[]> {
    return this.http.get<MasterComponent[]>(`${this.apiUrl}/masters/components`);
  }

  createPayrollComponent(data: any): Observable<MasterComponent> {
    return this.http.post<MasterComponent>(`${this.apiUrl}/masters/components`, data);
  }

  updatePayrollComponent(id: number, data: any): Observable<MasterComponent> {
    return this.http.put<MasterComponent>(`${this.apiUrl}/masters/components/${id}`, data);
  }

  deletePayrollComponent(id: number): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.apiUrl}/masters/components/${id}`);
  }

  getPayrollSalaryGroups(includeRetired = false): Observable<MasterSalaryGroup[]> {
    const qs = includeRetired ? '?includeRetired=true' : '';
    return this.http.get<MasterSalaryGroup[]>(`${this.apiUrl}/masters/groups${qs}`);
  }

  getPayrollSalaryGroup(id: number): Observable<MasterSalaryGroup> {
    return this.http.get<MasterSalaryGroup>(`${this.apiUrl}/masters/groups/${id}`);
  }

  savePayrollSalaryGroup(data: any): Observable<MasterSalaryGroup> {
    return this.http.post<MasterSalaryGroup>(`${this.apiUrl}/masters/groups`, data);
  }

  getPayrollStatutoryRates(): Observable<MasterStatutoryRate[]> {
    return this.http.get<MasterStatutoryRate[]>(`${this.apiUrl}/masters/statutory-rates`);
  }

  savePayrollStatutoryRate(data: any): Observable<MasterStatutoryRate> {
    return this.http.post<MasterStatutoryRate>(`${this.apiUrl}/masters/statutory-rates`, data);
  }

  updatePayrollStatutoryRate(id: number, data: any): Observable<MasterStatutoryRate> {
    return this.http.put<MasterStatutoryRate>(`${this.apiUrl}/masters/statutory-rates/${id}`, data);
  }

  getPayrollTaxRegimes(financialYear = '2026-27'): Observable<MasterTaxRegime[]> {
    return this.http.get<MasterTaxRegime[]>(`${this.apiUrl}/masters/tax-regimes?financialYear=${financialYear}`);
  }

  updatePayrollTaxRegime(id: number, data: any): Observable<MasterTaxRegime> {
    return this.http.put<MasterTaxRegime>(`${this.apiUrl}/masters/tax-regimes/${id}`, data);
  }

  validatePayrollFormula(formula: string): Observable<{ valid: boolean; sampleResult?: number; error?: string; variables?: string[] }> {
    return this.http.post<any>(`${this.apiUrl}/masters/validate-formula`, { formula });
  }

  calculateSalary(params: {
    annualCtc?: number;
    monthlyCtc?: number;
    groupId?: number;
    groupCode?: string;
    regimeCode?: 'NEW' | 'OLD';
    financialYear?: string;
    declarations?: { [key: string]: number };
    overrides?: { [key: string]: number };
  }): Observable<SalaryCalculationResult> {
    return this.http.post<SalaryCalculationResult>(`${this.apiUrl}/masters/calculate`, params);
  }

  getPayrollAuditLog(limit = 100): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/masters/audit-log?limit=${limit}`);
  }
}

export interface MasterComponent {
  id: number;
  code: string;
  name: string;
  category: 'EARNING' | 'EMPLOYEE_DEDUCTION' | 'EMPLOYER_CONTRIBUTION' | 'REIMBURSEMENT';
  partOfCtc: boolean;
  partOfGross: boolean;
  taxable: boolean;
  reduceForLop: boolean;
  showOnPayslip: boolean;
  showOnAnnexure: boolean;
  displayOrder: number;
  isSystem: boolean;
  isActive: boolean;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MasterSalaryGroupLine {
  id?: number;
  componentId: number;
  component?: MasterComponent;
  calcType: 'FIXED' | 'FORMULA' | 'STATUTORY' | 'BALANCING' | 'INPUT';
  amount?: number | null;
  formula?: string | null;
  condition?: string | null;
  overrideAllowed: boolean;
  displayOrder: number;
}

export interface MasterSalaryGroup {
  id: number;
  code: string;
  version: number;
  name: string;
  description?: string;
  payeeType: 'EMPLOYEE' | 'CONSULTANT' | 'TRAINEE';
  flatTdsPct?: number | null;
  gstApplicable: boolean;
  effectiveFrom: string;
  retiredAt?: string | null;
  isActive: boolean;
  lines: MasterSalaryGroupLine[];
}

export interface MasterStatutoryRate {
  id: number;
  code: string;
  stateCode?: string | null;
  ratePct?: number | null;
  wageCeiling?: number | null;
  eligibilityLimit?: number | null;
  fixedAmount?: number | null;
  notes?: string;
  effectiveFrom: string;
}

export interface MasterTaxRegime {
  id: number;
  code: 'NEW' | 'OLD';
  financialYear: string;
  name: string;
  standardDeduction: number;
  rebateIncomeLimit: number;
  rebateMaxAmount: number;
  cessPct: number;
  isDefault: boolean;
  slabs: { fromAmount: number; toAmount: number | null; ratePct: number }[];
  sections: { code: string; name: string; maxLimit: number | null; proofRequired: boolean }[];
}

export interface SalaryCalculationResult {
  ctcMonthly: number;
  ctcAnnual: number;
  grossMonthly: number;
  grossAnnual: number;
  totalEarningsMonthly: number;
  totalEarningsAnnual: number;
  totalDeductionsMonthly: number;
  totalDeductionsAnnual: number;
  totalEmployerContributionsMonthly: number;
  totalEmployerContributionsAnnual: number;
  netPayMonthly: number;
  netPayAnnual: number;
  lines: {
    code: string;
    name: string;
    category: string;
    monthly: number;
    annual: number;
    partOfCtc: boolean;
    partOfGross: boolean;
    showOnPayslip: boolean;
    showOnAnnexure: boolean;
  }[];
  tax?: any;
  warnings: string[];
}
