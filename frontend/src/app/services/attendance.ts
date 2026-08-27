import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Shift {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  bufferTimeMinutes: number;
}

export interface AttendanceRecord {
  id: number;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  clockInLat: number | null;
  clockInLng: number | null;
  clockOutLat: number | null;
  clockOutLng: number | null;
  status: 'PRESENT' | 'ABSENT' | 'HALF_DAY';
  isLate: boolean;
  isEarlyLeave: boolean;
  totalHours?: number;
  employeeId: number;
  employee?: any;
}

@Injectable({
  providedIn: 'root'
})
export class AttendanceService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/attendance`;

  getTodayAttendance(): Observable<AttendanceRecord | null> {
    return this.http.get<AttendanceRecord>(`${this.apiUrl}/me`);
  }

  getMyHistory(): Observable<AttendanceRecord[]> {
    return this.http.get<AttendanceRecord[]>(`${this.apiUrl}/history/me`);
  }

  getEmployeeHistory(employeeId: number): Observable<AttendanceRecord[]> {
    return this.http.get<AttendanceRecord[]>(`${this.apiUrl}/employee/${employeeId}`);
  }

  clockIn(lat?: number, lng?: number) {
    return this.http.post<AttendanceRecord>(`${this.apiUrl}/clock-in`, { lat, lng });
  }

  clockOut(lat?: number, lng?: number) {
    return this.http.post<AttendanceRecord>(`${this.apiUrl}/clock-out`, { lat, lng });
  }

  getMyRegularizations(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/regularization/me`);
  }

  getPendingRegularizations(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/regularization/pending`);
  }

  requestRegularization(data: { date: string, proposedClockIn?: string, proposedClockOut?: string, reason: string }) {
    return this.http.post(`${this.apiUrl}/regularization`, data);
  }

  resolveRegularization(id: number, status: string, rejectionReason?: string) {
    return this.http.post(`${this.apiUrl}/regularization/${id}/resolve`, { status, rejectionReason });
  }

  getTeamTimeline(start: string, end: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/team/timeline?start=${start}&end=${end}`);
  }

  getAllEmployeesAttendance(filters: { month?: number; year?: number; employeeId?: number; departmentId?: number; status?: string }): Observable<AttendanceRecord[]> {
    const params: string[] = [];
    if (filters.month) params.push(`month=${filters.month}`);
    if (filters.year) params.push(`year=${filters.year}`);
    if (filters.employeeId) params.push(`employeeId=${filters.employeeId}`);
    if (filters.departmentId) params.push(`departmentId=${filters.departmentId}`);
    if (filters.status) params.push(`status=${filters.status}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    return this.http.get<AttendanceRecord[]>(`${this.apiUrl}/all${qs}`);
  }
}
