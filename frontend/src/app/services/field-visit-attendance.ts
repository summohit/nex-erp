import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface FieldVisitTask {
  id: number;
  key: string;
  title: string;
  status: string;
}

export interface FieldVisitSite {
  id: number;
  requestNumber: string;
  status: string;
  location: string;
  latitude: number;
  longitude: number;
  /** The radius this day is judged against — 500m unless the request says otherwise. */
  geofenceRadiusM: number;
  startTime: string;
  endTime: string;
  project?: { id: number; name: string; key?: string | null } | null;
}

/** One person, one day of an approved trip. */
export interface FieldVisitDay {
  id: number;
  visitDate: string;
  isHoliday: boolean;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';
  clockInTime?: string | null;
  clockInDistanceKm?: number | null;
  clockOutTime?: string | null;
  clockOutDistanceKm?: number | null;
  issue?: { id: number; key: string; title: string } | null;
  request: FieldVisitSite;
  tasks: FieldVisitTask[];
}

export interface ClockPayload {
  requestId?: number;
  issueId?: number;
  lat: number;
  lng: number;
}

@Injectable({ providedIn: 'root' })
export class FieldVisitAttendanceService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/field-visit-attendance`;

  /** What the employee is on today, with the tasks they may clock against. */
  getToday() {
    return this.http.get<FieldVisitDay[]>(`${this.apiUrl}/today`);
  }

  clockIn(payload: ClockPayload) {
    return this.http.post<FieldVisitDay>(`${this.apiUrl}/clock-in`, payload);
  }

  clockOut(payload: ClockPayload) {
    return this.http.post<FieldVisitDay>(`${this.apiUrl}/clock-out`, payload);
  }
}
