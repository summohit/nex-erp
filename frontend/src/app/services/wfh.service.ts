import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Work From Home requests (19 Oct 2026). */
export interface WfhRequest {
  id: number; employeeId: number; date: string; reason: string;
  status: 'PENDING_MANAGER' | 'PENDING_HR' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  source?: 'REQUEST' | 'ASSIGNED';
  reviewNote?: string | null; reviewedAt?: string | null; createdAt: string;
  reviewedBy?: { firstName: string; lastName: string | null } | null;
  employee?: any;
}

@Injectable({ providedIn: 'root' })
export class WfhService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/wfh`;

  settings() { return this.http.get<{ wfhDaysPerMonth: number }>(`${this.url}/settings`); }
  saveSettings(wfhDaysPerMonth: number) { return this.http.put<{ wfhDaysPerMonth: number }>(`${this.url}/settings`, { wfhDaysPerMonth }); }
  mine(): Observable<{ limit: number; usedThisMonth: number; requests: WfhRequest[]; counts?: { approved: number; pending: number; rejected: number; assigned: number } }> { return this.http.get<any>(`${this.url}/mine`); }
  /** HR / super admin (21 Oct 2026): approved at once, outside the monthly limit. */
  assign(employeeIds: number[], dates: string[], reason?: string) { return this.http.post<{ created: number; skipped: number }>(`${this.url}/assign`, { employeeIds, dates, reason }); }
  report(month: number, year: number, departmentId?: number | string) {
    return this.http.get<any>(`${this.url}/report`, { params: { month, year, ...(departmentId ? { departmentId: String(departmentId) } : {}) } });
  }
  adminCancel(id: number) { return this.http.post(`${this.url}/${id}/admin-cancel`, {}); }
  create(date: string, reason: string) { return this.http.post<WfhRequest>(this.url, { date, reason }); }
  cancel(id: number) { return this.http.post<WfhRequest>(`${this.url}/${id}/cancel`, {}); }
  pending(): Observable<WfhRequest[]> { return this.http.get<WfhRequest[]>(`${this.url}/pending`); }
  canApprove() { return this.http.get<{ canApprove: boolean }>(`${this.url}/can-approve`); }
  review(id: number, action: 'APPROVE' | 'REJECT', note?: string) { return this.http.post<WfhRequest>(`${this.url}/${id}/review`, { action, note }); }
}
