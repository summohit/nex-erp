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
  /** §Att4/§Att5: the proof attached to a late clock-out, and its ruling. */
  clockOutProofUrl?: string | null;
  clockOutApproval?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  clockOutApprovedAt?: string | null;
  clockOutReviewNote?: string | null;
  /** Live "session still open and overdue" flag; cleared once the day closes. */
  missedClockOut?: boolean;
  isOnsite?: boolean;
  project?: { id: number; name: string; key?: string } | null;
  fieldVisit?: {
    requestId?: number;
    requestNumber?: string;
    location?: string;
    startTime?: string;
    endTime?: string;
    projectName?: string;
    projectKey?: string;
    status?: string;
  } | null;
  employeeId: number;
  employee?: any;
  logs?: any[];
}


/** §Att7: attendance rolled up by shift over a week or a month. */
export interface ShiftPeriodRow {
  shiftId: number | null;
  name: string;
  shortCode: string | null;
  colorCode: string | null;
  present: number;
  halfDay: number;
  absent: number;
  onLeave: number;
  weeklyOff: number;
  holiday: number;
  late: number;
  earlyLeave: number;
  hours: number;
  overtimeHours: number;
  people: number;
  /** Days anybody was expected — the denominator for "how did this shift do". */
  workingDays: number;
}

export interface ShiftPeriodSummary {
  period: 'week' | 'month';
  from: string;
  to: string;
  label: string;
  days: number;
  shifts: ShiftPeriodRow[];
  totals: {
    present: number; halfDay: number; absent: number;
    onLeave: number; late: number; hours: number;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AttendanceService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/attendance`;

  importAttendance(rows: Array<{ employeeId: number; date: string; status?: string; clockIn?: string; clockOut?: string }>) {
    return this.http.post<{ imported: number; skipped: number }>(`${this.apiUrl}/import`, { rows });
  }

  /** §Att7: attendance grouped by shift, for a week or a month. */
  getShiftPeriodSummary(
    period: 'week' | 'month',
    date?: string,
    filters?: { from?: string; to?: string; employee?: string },
  ) {
    const params: Record<string, string> = { period };
    if (date) params['date'] = date;
    if (filters?.from) params['from'] = filters.from;
    if (filters?.to) params['to'] = filters.to;
    if (filters?.employee) params['employee'] = filters.employee;
    return this.http.get<ShiftPeriodSummary>(`${this.apiUrl}/shift-summary`, { params });
  }

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

  /** `outsideReason` answers OUTSIDE_OFFICE_REASON_REQUIRED (B3). */
  clockIn(lat?: number, lng?: number, outsideReason?: string, outsideProofUrl?: string) {
    return this.http.post<AttendanceRecord>(`${this.apiUrl}/clock-in`, { lat, lng, outsideReason, outsideProofUrl });
  }

  /**
   * `reason` is required — and only accepted — when the session being closed
   * belongs to a previous IST day. The server decides; the client sends it in
   * response to a LATE_CLOCK_OUT_REASON_REQUIRED refusal.
   */
  clockOut(
    lat?: number, lng?: number, reason?: string, proofUrl?: string,
    outsideReason?: string, outsideProofUrl?: string,
  ) {
    return this.http.post<AttendanceRecord>(`${this.apiUrl}/clock-out`, {
      lat, lng, reason, proofUrl, outsideReason, outsideProofUrl,
    });
  }

  // B3: clock-ins / clock-outs made outside the office radius.
  getPendingGeofence(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/geofence/pending`);
  }

  canApproveGeofence(): Observable<{ canApprove: boolean }> {
    return this.http.get<{ canApprove: boolean }>(`${this.apiUrl}/geofence/can-approve`);
  }

  reviewGeofence(id: number, action: 'APPROVE' | 'REJECT', note?: string) {
    return this.http.post<AttendanceRecord>(`${this.apiUrl}/geofence/${id}/review`, { action, note });
  }

  // §Att5: the late clock-out queue.
  getPendingClockOuts(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/clock-out/pending`);
  }

  /** Whether to show the queue at all — the answer is partly a delegate list,
   *  so the client asks rather than inferring it from the role. */
  canApproveClockOuts(): Observable<{ canApprove: boolean }> {
    return this.http.get<{ canApprove: boolean }>(`${this.apiUrl}/clock-out/can-approve`);
  }

  getMyClockOutApprovals(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/clock-out/mine`);
  }

  reviewClockOut(id: number, action: 'APPROVE' | 'REJECT', note?: string) {
    return this.http.post<AttendanceRecord>(`${this.apiUrl}/clock-out/${id}/review`, { action, note });
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

  getAllEmployeesAttendance(filters: {
    month?: number; year?: number; employeeId?: number; departmentId?: number;
    status?: string; from?: string; to?: string; all?: boolean;
  }): Observable<AttendanceRecord[]> {
    const params: string[] = [];
    if (filters.month) params.push(`month=${filters.month}`);
    if (filters.year) params.push(`year=${filters.year}`);
    if (filters.employeeId) params.push(`employeeId=${filters.employeeId}`);
    if (filters.departmentId) params.push(`departmentId=${filters.departmentId}`);
    if (filters.status) params.push(`status=${filters.status}`);
    if (filters.from) params.push(`from=${encodeURIComponent(filters.from)}`);
    if (filters.to) params.push(`to=${encodeURIComponent(filters.to)}`);
    if (filters.all) params.push('all=true');
    const qs = params.length ? `?${params.join('&')}` : '';
    return this.http.get<AttendanceRecord[]>(`${this.apiUrl}/all${qs}`);
  }
}
