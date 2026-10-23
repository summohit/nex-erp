import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';

/** A place work can be carried out: a state, a city in it, or a site. */
export interface TaskLocation {
  id: number;
  name: string;
  code: string | null;
  level: 'STATE' | 'CITY' | 'SITE';
  parentId: number | null;
  isActive: boolean;
  position: number;
  usageCount?: number;
  /** Shown as a group heading only: a task in this project cannot be placed at it. */
  headerOnly?: boolean;
}

export type LocationStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | 'BLOCKED';

export const LOCATION_STATUS_LABEL: Record<LocationStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  COMPLETED: 'Completed',
  BLOCKED: 'Blocked',
};

export interface LocationProgress {
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  overdue: number;
  notStarted: number;
  percent: number;
}

export interface LocationPerson { id: number; firstName: string; lastName: string | null; avatarUrl: string | null }

/** A city a project works in, by name (23 Oct 2026). */
export interface ProjectCity { id?: number; state: string; city: string; openTasks?: number }
/** A site that belongs to one project. */
export interface ProjectSite { id?: number; name: string; state: string; city: string; openTasks?: number }

/** A project's cities and sites, and what its tasks may pick. */
export interface ProjectLocations {
  cities: ProjectCity[];
  sites: ProjectSite[];
  /** States (as headers), cities and active sites; null = the project lists none. */
  options: TaskLocation[] | null;
}

/** One location of one task, as the task detail shows it. */
export interface IssueLocationRow {
  id: number;
  issueId: number;
  locationId: number;
  status: LocationStatus;
  startDate: string | null;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  remarks: string | null;
  blockedReason: string | null;
  removedAt: string | null;
  location: { id: number; name: string; code: string | null; level: string; parentId: number | null; parent: { id: number; name: string; level: string } | null };
  assignees: { employeeId: number; employee: LocationPerson }[];
  _count: { attachments: number; timeLogs: number };
  loggedMinutes?: number;
  overdue: boolean;
  canUpdate?: boolean;
  issue?: { id: number; key: string; title: string; status: string; priority: string; dueDate: string | null; projectId: number; project: { id: number; name: string } };
}

export interface IssueLocations {
  canManage: boolean;
  taskStatus?: string;
  progress: LocationProgress;
  locations: IssueLocationRow[];
}

export interface LocationActivity {
  id: number;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  body: string | null;
  createdAt: string;
  actor: LocationPerson;
  personName: string | null;
}

export interface LocationReportRow extends LocationProgress {
  issue: IssueLocationRow['issue'];
  pending: number;
  pendingLocations: string[];
}

/**
 * Per-location execution tracking: each location's own status, people,
 * dates, time and evidence; the Location Progress panel; the "N/M locations"
 * card pill; and Tasks → By location. Off for now (23 Oct 2026) — tasks just
 * name their locations. The server has the same switch in
 * backend/src/projects/task-locations/location-rules.ts; flip both together.
 */
export const LOCATION_TRACKING_ENABLED = false;

@Injectable({ providedIn: 'root' })
export class TaskLocationsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  projectLocations(projectId: number): Observable<ProjectLocations> {
    return this.http.get<ProjectLocations>(`${this.api}/projects/${projectId}/locations`);
  }
  saveProjectLocations(projectId: number, body: { cities: ProjectCity[]; sites: ProjectSite[] }): Observable<ProjectLocations> {
    return this.http.put<ProjectLocations>(`${this.api}/projects/${projectId}/locations`, body);
  }
  /** What a task in this project may be placed at: its own locations, else the whole list. */
  forProject(projectId: number | null | undefined): Observable<TaskLocation[]> {
    if (!projectId) return this.list(true);
    return this.projectLocations(projectId).pipe(
      switchMap((p) => (p.options ? of(p.options) : this.list(true))),
    );
  }

  list(activeOnly = false): Observable<TaskLocation[]> {
    return this.http.get<TaskLocation[]>(`${this.api}/task-locations${activeOnly ? '?activeOnly=true' : ''}`);
  }
  create(data: Partial<TaskLocation>): Observable<TaskLocation> {
    return this.http.post<TaskLocation>(`${this.api}/task-locations`, data);
  }
  bulkCreate(data: { names: string[]; level: string; parentId: number | null }): Observable<{ created: number; skipped: number }> {
    return this.http.post<{ created: number; skipped: number }>(`${this.api}/task-locations/bulk`, data);
  }
  update(id: number, data: Partial<TaskLocation>): Observable<TaskLocation> {
    return this.http.put<TaskLocation>(`${this.api}/task-locations/${id}`, data);
  }
  remove(id: number): Observable<{ deleted: boolean; disabled: boolean; message?: string }> {
    return this.http.delete<{ deleted: boolean; disabled: boolean; message?: string }>(`${this.api}/task-locations/${id}`);
  }
  executions(filters: Record<string, any>): Observable<IssueLocationRow[]> {
    return this.http.get<IssueLocationRow[]>(`${this.api}/task-locations/executions`, { params: clean(filters) });
  }
  report(filters: Record<string, any>): Observable<LocationReportRow[]> {
    return this.http.get<LocationReportRow[]>(`${this.api}/task-locations/report`, { params: clean(filters) });
  }

  private base(projectId: number, issueId: number) {
    return `${this.api}/projects/${projectId}/issues/${issueId}/locations`;
  }
  forIssue(projectId: number, issueId: number): Observable<IssueLocations> {
    return this.http.get<IssueLocations>(this.base(projectId, issueId));
  }
  add(projectId: number, issueId: number, data: {
    locationIds?: number[];
    assigneeIds?: number[];
    startDate?: string | null;
    dueDate?: string | null;
    status?: LocationStatus;
    locations?: any[];
  }): Observable<IssueLocations> {
    return this.http.post<IssueLocations>(this.base(projectId, issueId), data);
  }
  /** Replace the task's one location. */
  setLocation(projectId: number, issueId: number, locationId: number): Observable<IssueLocations> {
    return this.http.put<IssueLocations>(this.base(projectId, issueId), { locationId });
  }
  updateRow(projectId: number, issueId: number, rowId: number, data: any): Observable<IssueLocations> {
    return this.http.patch<IssueLocations>(`${this.base(projectId, issueId)}/${rowId}`, data);
  }
  removeRow(projectId: number, issueId: number, rowId: number): Observable<{ removed: boolean; soft: boolean }> {
    return this.http.delete<{ removed: boolean; soft: boolean }>(`${this.base(projectId, issueId)}/${rowId}`);
  }
  comment(projectId: number, issueId: number, rowId: number, body: string): Observable<LocationActivity> {
    return this.http.post<LocationActivity>(`${this.base(projectId, issueId)}/${rowId}/comments`, { body });
  }
  logTime(projectId: number, issueId: number, rowId: number, data: { durationMin: number; note?: string; date?: string }): Observable<IssueLocations> {
    return this.http.post<IssueLocations>(`${this.base(projectId, issueId)}/${rowId}/time-log`, data);
  }
  linkEvidence(projectId: number, issueId: number, rowId: number, attachmentIds: number[]): Observable<IssueLocations> {
    return this.http.post<IssueLocations>(`${this.base(projectId, issueId)}/${rowId}/evidence`, { attachmentIds });
  }
  /** Uploads through the task's own attachment route; evidence is a task file. */
  uploadToTask(projectId: number, issueId: number, files: File[]): Observable<any> {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    return this.http.post(`${this.api}/projects/${projectId}/issues/${issueId}/attachments/upload`, form);
  }
  activity(projectId: number, issueId: number, rowId: number): Observable<{ activity: LocationActivity[]; evidence: any[] }> {
    return this.http.get<{ activity: LocationActivity[]; evidence: any[] }>(`${this.base(projectId, issueId)}/${rowId}/activity`);
  }
}

function clean(o: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') out[k] = String(v);
  return out;
}

/** "Mumbai, Maharashtra" — a location with the place it sits in. */
export function locationLabel(loc: { name: string; parent?: { name: string } | null }): string {
  return loc.parent ? `${loc.name}, ${loc.parent.name}` : loc.name;
}
