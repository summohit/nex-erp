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
  status: 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'ON_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF';
  isLate: boolean;
  isEarlyLeave: boolean;
  /**
   * Nobody clocked out — the 23:00 IST sweep closed the day. The clock-out is
   * a cutoff rather than a departure, and its coordinates are the clock-in's
   * reused, so don't render either as an observation.
   */
  autoClockedOut?: boolean;
  totalHours?: number;
  overtimeHours?: number;
  /**
   * The day was left open past IST midnight and closed late — the server asked
   * for (and stored) a reason for the missed clock-out.
   */
  clockOutReason?: string | null;
  /** Live "session still open and overdue" flag; cleared once the day closes. */
  missedClockOut?: boolean;
  employeeId: number;
  employee?: any;
  logs?: any[];
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

  /**
   * `from`/`to` are ISO dates. The grid renders one month, so passing that
   * month keeps the response to ~30 rows; omitting them makes the server fall
   * back to a bounded recent window rather than the whole history.
   */
  getMyHistory(from?: string, to?: string): Observable<AttendanceRecord[]> {
    return this.http.get<AttendanceRecord[]>(`${this.apiUrl}/history/me`, {
      params: from && to ? { from, to } : {},
    });
  }

  getEmployeeHistory(employeeId: number, from?: string, to?: string): Observable<AttendanceRecord[]> {
    return this.http.get<AttendanceRecord[]>(`${this.apiUrl}/employee/${employeeId}`, {
      params: from && to ? { from, to } : {},
    });
  }

  clockIn(lat?: number, lng?: number) {
    return this.http.post<AttendanceRecord>(`${this.apiUrl}/clock-in`, { lat, lng });
  }

  /**
   * `reason` is required — and only accepted — when the session being closed
   * belongs to a previous IST day. The server decides; the client sends it in
   * response to a LATE_CLOCK_OUT_REASON_REQUIRED refusal.
   */
  clockOut(lat?: number, lng?: number, reason?: string) {
    return this.http.post<AttendanceRecord>(`${this.apiUrl}/clock-out`, { lat, lng, reason });
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
