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
  };
  employee?: {
    id: number;
    firstName: string;
    lastName: string;
  };
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

  requestLeave(data: { leaveTypeId: number, startDate: string, endDate: string, reason?: string, attachmentUrl?: string }): Observable<LeaveRequest> {
    return this.http.post<LeaveRequest>(`${this.apiUrl}/request`, data);
  }

  getMyRequests(): Observable<LeaveRequest[]> {
    return this.http.get<LeaveRequest[]>(`${this.apiUrl}/requests/me`);
  }

  getRequests() {
    return this.http.get<LeaveRequest[]>(`${this.apiUrl}/requests`);
  }

  updateRequestStatus(id: number, status: string, rejectionReason?: string) {
    return this.http.put<LeaveRequest>(`${this.apiUrl}/requests/${id}/status`, { status, rejectionReason });
  }

  updateRequest(id: number, data: { startDate?: string, endDate?: string, reason?: string, attachmentUrl?: string }) {
    return this.http.put<LeaveRequest>(`${this.apiUrl}/requests/${id}`, data);
  }

  cancelRequest(id: number) {
    return this.http.put<LeaveRequest>(`${this.apiUrl}/requests/${id}/cancel`, {});
  }
}
