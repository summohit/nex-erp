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
  carriedOver: number;
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
  carriedOver: number;
  remaining: number;
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
  leaveTypes: { id: number; name: string; isPaid: boolean; carryForward: boolean; carryForwardLimit: number }[];
  rows: QuotaRow[];
  /** 'SELF' when the caller may only see their own figures. */
  scope: 'ALL' | 'SELF';
  /** False until the 1 January job has run — remaining figures understate until then. */
  carryForwardApplied: boolean;
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
    name: string;
  };
  employee?: {
    firstName: string;
    lastName: string;
  };
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

  getAllBalances(year?: number) {
    const params: any = {};
    if (year) params.year = year.toString();
    return this.http.get<LeaveBalance[]>(`${this.apiUrl}/balances`, { params });
  }

  /** The quota report. The server scopes non-admins to their own row. */
  getQuotaReport(year?: number, employeeId?: number): Observable<QuotaReport> {
    const params: any = {};
    if (year) params.year = year.toString();
    if (employeeId) params.employeeId = employeeId.toString();
    return this.http.get<QuotaReport>(`${this.apiUrl}/reports/quota`, { params });
  }

  requestLeave(data: { leaveTypeId: number, startDate: string, endDate: string, reason?: string, attachmentUrl?: string, isHalfDay?: boolean, halfDayPeriod?: string }): Observable<LeaveRequest> {
    return this.http.post<LeaveRequest>(`${this.apiUrl}/request`, data);
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
}
