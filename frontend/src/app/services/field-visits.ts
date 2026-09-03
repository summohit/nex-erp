import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface FieldVisitEmployee {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
}

export interface FieldVisitProject {
  id: number;
  name: string;
  key?: string | null;
  color?: string | null;
}

export interface FieldVisitPhoto {
  id: number;
  url: string;
  takenAt: string;
  caption?: string | null;
}

export interface FieldVisit {
  id: number;
  employeeId: number;
  employee?: FieldVisitEmployee;
  projectId: number;
  project?: FieldVisitProject;
  companyId: number;
  startTime: string;
  startLat: number;
  startLng: number;
  startAddress?: string | null;
  endTime?: string | null;
  endLat?: number | null;
  endLng?: number | null;
  endAddress?: string | null;
  distanceKm?: number | null;
  durationMins?: number | null;
  routePoints?: [number, number, number][] | null;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  purpose?: string | null;
  notes?: string | null;
  photos?: FieldVisitPhoto[];
}

export interface FieldVisitSummary {
  total: number;
  active: number;
  completed: number;
  cancelled: number;
  totalDistanceKm: number;
  totalDurationMins: number;
  photoCount: number;
  employeesOut: number;
}

export interface FieldVisitPage {
  visits: FieldVisit[];
  summary: FieldVisitSummary;
}

export interface FieldVisitFilters {
  from?: string;
  to?: string;
  employeeId?: number;
  projectId?: number;
  status?: string;
}

@Injectable({
  providedIn: 'root',
})
export class FieldVisitsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/field-visits`;

  /** Visit history for one project — powers the project detail "Field Visits" tab. */
  getProjectVisits(projectId: number) {
    return this.http.get<FieldVisit[]>(`${this.apiUrl}/project/${projectId}`);
  }

  /** Everyone currently out on a visit, company-wide — powers the CRM widget. */
  getCompanyActiveVisits() {
    return this.http.get<FieldVisit[]>(`${this.apiUrl}/company/active`);
  }

  /** Most recently finished visits company-wide, for the same widget's feed. */
  getCompanyRecentVisits(limit = 10) {
    return this.http.get<FieldVisit[]>(`${this.apiUrl}/company/recent`, {
      params: { limit: String(limit) },
    });
  }

  /** Filtered company-wide log + matching KPI summary — the Field Visits page. */
  getCompanyVisits(filters: FieldVisitFilters = {}) {
    let params = new HttpParams();
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.employeeId) params = params.set('employeeId', String(filters.employeeId));
    if (filters.projectId) params = params.set('projectId', String(filters.projectId));
    if (filters.status) params = params.set('status', filters.status);
    return this.http.get<FieldVisitPage>(`${this.apiUrl}/company`, { params });
  }

  getVisit(id: number) {
    return this.http.get<FieldVisit>(`${this.apiUrl}/${id}`);
  }
}
