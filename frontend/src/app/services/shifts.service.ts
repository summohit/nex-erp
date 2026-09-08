import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Shift } from './attendance';

@Injectable({
  providedIn: 'root'
})
export class ShiftsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/shifts`;

  getShifts(): Observable<Shift[]> {
    return this.http.get<Shift[]>(this.apiUrl);
  }

  getMyShift(): Observable<{ shift: Shift | null; rotations: any[] }> {
    return this.http.get<{ shift: Shift | null; rotations: any[] }>(`${this.apiUrl}/me`);
  }

  createShift(data: Partial<Shift>): Observable<Shift> {
    return this.http.post<Shift>(this.apiUrl, data);
  }

  updateShift(id: number, data: Partial<Shift>): Observable<Shift> {
    return this.http.put<Shift>(`${this.apiUrl}/${id}`, data);
  }

  deleteShift(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  getShiftEmployees(shiftId: number): Observable<{
    shift: Shift;
    employees: any[];
    totalCount: number;
  }> {
    return this.http.get<{
      shift: Shift;
      employees: any[];
      totalCount: number;
    }>(`${this.apiUrl}/${shiftId}/employees`);
  }

  // ── Shift roster ────────────────────────────────────────────────────────
  getRoster(q: { start: string; end: string; departmentId?: number; employeeId?: number }): Observable<RosterGrid> {
    const params: string[] = [`start=${q.start}`, `end=${q.end}`];
    if (q.departmentId) params.push(`departmentId=${q.departmentId}`);
    if (q.employeeId) params.push(`employeeId=${q.employeeId}`);
    return this.http.get<RosterGrid>(`${this.apiUrl}/roster?${params.join('&')}`);
  }

  assignRoster(data: RosterAssignmentPayload) {
    return this.http.post(`${this.apiUrl}/roster`, data);
  }

  bulkAssignRoster(data: RosterBulkPayload) {
    return this.http.post<{ written: number; skipped: number }>(`${this.apiUrl}/roster/bulk`, data);
  }

  clearRoster(data: { employeeIds: number[]; start: string; end: string }) {
    return this.http.post<{ cleared: number }>(`${this.apiUrl}/roster/clear`, data);
  }

  // ── On-site ("No Project") approvals ────────────────────────────────────
  getOnsitePending() {
    return this.http.get<any[]>(`${this.apiUrl}/roster/onsite/pending`);
  }

  resolveOnsiteApproval(entryId: number, action: 'APPROVED' | 'REJECTED') {
    return this.http.post(`${this.apiUrl}/roster/onsite/${entryId}/resolve`, { action });
  }
}

export interface RosterOnSiteInfo {
  projectId: number | null;
  projectName?: string | null;
  address: string | null;
  approvalStatus: string; // NONE, PENDING, APPROVED, REJECTED
}

export interface RosterAssignmentPayload {
  employeeId: number;
  date: string;
  shiftId?: number | null;
  isDayOff?: boolean;
  note?: string;
  /** On-site shift details */
  projectId?: number | null;
  address?: string | null;
  /** True when the requester chose "No Project" — routes the row to Admin + HR. */
  needsApproval?: boolean;
}

export interface RosterBulkPayload {
  employeeIds: number[]; start: string; end: string;
  shiftId?: number | null; isDayOff?: boolean;
  skipNonWorkingDays?: boolean; overwriteExisting?: boolean;
  projectId?: number | null;
  address?: string | null;
  needsApproval?: boolean;
}

export interface RosterShift {
  id: number;
  name: string;
  shortCode?: string | null;
  colorCode?: string | null;
  shiftType?: string;
  startTime?: string | null;
  endTime?: string | null;
  totalHours?: number | null;
  workingDays?: string | null;
}

export interface RosterCell {
  date: string;
  type: 'SHIFT' | 'DAY_OFF' | 'LEAVE' | 'UNASSIGNED';
  shift?: RosterShift;
  label?: string;
  isHalfDay?: boolean;
  /** True when the cell reflects the employee's standing shift, not an explicit entry. */
  isDefault?: boolean;
  entryId?: number;
  note?: string | null;
  /** Present when the roster entry carries on-site location/approval info. */
  onSite?: RosterOnSiteInfo;
}

export interface RosterRow {
  employee: {
    id: number; name: string; employeeCode?: string | null;
    avatarUrl?: string | null; department?: string | null; designation?: string | null;
    isActive?: boolean;
  };
  defaultShift: { id: number; name: string } | null;
  cells: RosterCell[];
}

export interface RosterGrid {
  days: string[];
  shifts: RosterShift[];
  rows: RosterRow[];
}
