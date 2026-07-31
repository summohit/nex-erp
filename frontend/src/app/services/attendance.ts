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
}
