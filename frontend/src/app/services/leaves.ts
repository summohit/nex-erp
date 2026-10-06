import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

export interface LeaveBalance {
  id: number;
  employeeId: number;
  leaveTypeId: number;
  allocated: number;
  used: number;
  year: number;
  leaveType: {
    id: number;
    name: string;
    isPaid: boolean;
    allowHalfDay?: boolean;
  };
  employee?: {
    id: number;
    firstName: string;
    lastName: string;
  };
}

/** One employee's figures for a single leave type, in the quota report. */
export interface QuotaCell {
  allocated: number;
  used: number;
  remaining: number;
  /** Of the remaining days, how many were paid out when the year closed. */
  encashed: number;
}

export interface QuotaRow {
  employee: {
    id: number;
    name: string;
    employeeCode: string | null;
    avatarUrl: string | null;
    designation: string | null;
    department: string | null;
    isActive: boolean;
  };
  byType: Record<number, QuotaCell>;
  totals: QuotaCell;
  /** No balance row exists at all — different from a zero balance, and fixable. */
  hasNoBalances: boolean;
}

export interface QuotaReport {
  year: number;
  leaveTypes: { id: number; name: string; isPaid: boolean; encashable: boolean; encashmentLimit: number }[];
  rows: QuotaRow[];
  /** 'SELF' when the caller may only see their own figures. */
  scope: 'ALL' | 'SELF';
  /**
   * True once the year's closing payslip has bought back its unused days.
   * Until then the remaining figures are days still there to take; afterwards
   * they are days already paid for.
   */
  encashmentSettled: boolean;
}

export interface LeaveRequest {
  id: number;
  employeeId: number;
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  reason: string | null;
  attachmentUrl?: string | null;
  status: string;
  rejectionReason?: string | null;
  isHalfDay?: boolean;
  halfDayPeriod?: string | null;
  leaveType: {
    id?: number;
    name: string;
    isPaid?: boolean;
  };
  employee?: {
    id?: number;
    firstName: string;
    lastName: string;
    avatarUrl?: string | null;
    employeeCode?: string | null;
    designation?: { name: string } | null;
    department?: { name: string } | null;
  };
  /**
   * §Att9: set when somebody other than the employee raised this. Null — the
   * overwhelming majority — means they applied for it themselves.
   */
  raisedById?: number | null;
  raisedBy?: {
    email?: string;
    employee?: { firstName: string; lastName: string } | null;
  } | null;
}

/**
 * An approved field visit the requested leave lands on (§9).
 *
 * The request is still filed — this is what the employee is told about it, and
 * what the approver has to weigh.
 */
export interface FieldVisitConflict {
  requestNumber: string;
  location: string;
  days: number;
  dates: string[];
}

export interface LeaveRequestResult extends LeaveRequest {
  fieldVisitConflicts?: FieldVisitConflict[];
}

@Injectable({
  providedIn: 'root'
})
export class LeavesService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/leaves`;

  assignBalance(data: { employeeId: number, leaveTypeId: number, allocated: number, year: number }) {
    return this.http.post<LeaveBalance>(`${this.apiUrl}/assign-balance`, data);
  }

  getMyBalances(year?: number) {
    const params: any = {};
    if (year) params.year = year.toString();
    return this.http.get<LeaveBalance[]>(`${this.apiUrl}/balances/me`, { params });
  }

  getAllBalances(year?: number, employeeId?: number, limit = 200) {
    const params: any = {};
    if (year) params.year = year.toString();
    if (employeeId) params.employeeId = employeeId.toString();
    params.limit = limit.toString();
    return this.http.get<LeaveBalance[]>(`${this.apiUrl}/balances`, { params });
  }

  /** The quota report. The server scopes non-admins to their own row. */
  getQuotaReport(year?: number, employeeId?: number): Observable<QuotaReport> {
    const params: any = {};
    if (year) params.year = year.toString();
    if (employeeId) params.employeeId = employeeId.toString();
    return this.http.get<QuotaReport>(`${this.apiUrl}/reports/quota`, { params });
  }

  requestLeave(data: { leaveTypeId: number, startDate: string, endDate: string, reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string }): Observable<LeaveRequestResult> {
    return this.http.post<LeaveRequestResult>(`${this.apiUrl}/request`, data);
  }

  getMyRequests(): Observable<LeaveRequest[]> {
    return this.http.get<LeaveRequest[]>(`${this.apiUrl}/requests/me`);
  }

  getRequests() {
    return this.http.get<LeaveRequest[]>(`${this.apiUrl}/requests`);
  }

  getManagerRequests() {
    return this.http.get<LeaveRequest[]>(`${this.apiUrl}/requests/managers`);
  }

  updateRequestStatus(id: number, status: string, rejectionReason?: string) {
    return this.http.put<LeaveRequest>(`${this.apiUrl}/requests/${id}/status`, { status, rejectionReason });
  }

  updateRequest(id: number, data: { startDate?: string, endDate?: string, reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string }) {
    return this.http.put<LeaveRequest>(`${this.apiUrl}/requests/${id}`, data);
  }

  cancelRequest(id: number) {
    return this.http.put<LeaveRequest>(`${this.apiUrl}/requests/${id}/cancel`, {});
  }

  /**
   * Apply leave for somebody else (§Att9).
   *
   * Its own endpoint rather than an employeeId on `requestLeave`, so the
   * on-behalf path cannot be reached by adding a field to an ordinary request.
   * Approved on arrival — the people allowed to do this are the people who
   * approve leave.
   */
  requestLeaveOnBehalf(data: {
    employeeId: number, leaveTypeId: number, startDate: string, endDate: string,
    reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string,
  }): Observable<LeaveRequestResult> {
    return this.http.post<LeaveRequestResult>(`${this.apiUrl}/request/on-behalf`, data);
  }

  /** Whether to offer the option — partly a delegate list, so the client asks. */
  canActOnBehalf(): Observable<{ canActOnBehalf: boolean }> {
    return this.http.get<{ canActOnBehalf: boolean }>(`${this.apiUrl}/request/can-act-on-behalf`);
  }

  /** §Att10: Super Admin only. A soft delete — gone for every reader. */
  deleteRequest(id: number) {
    return this.http.delete<{ deleted: boolean; id: number }>(`${this.apiUrl}/requests/${id}`);
  }
}
