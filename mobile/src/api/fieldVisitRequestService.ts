import { apiClient } from './apiClient';

/**
 * Field visits as the web runs them: a request (site, dates, people, tasks),
 * an approval, then a site-checked clock-in for each approved day.
 *
 * Replaces the app's old ad-hoc /field-visits/start flow, which the web no
 * longer uses.
 */

export type FvStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED';

export interface FvPerson { id: number; firstName: string; lastName?: string | null; avatarUrl?: string | null }

export interface FieldVisitRequest {
  id: number;
  requestNumber: string;
  location: string;
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
  startDate: string;
  endDate: string;
  visitDays: number;
  startTime: string;
  endTime: string;
  remarks?: string | null;
  status: FvStatus;
  rejectionReason?: string | null;
  createdAt: string;
  project?: { id: number; name: string; key: string; isSystem?: boolean } | null;
  raisedBy?: FvPerson | null;
  members: { id: number; employee: FvPerson }[];
  tasks: { id: number; name: string; issueId?: number | null; issue?: { id: number; key: string; title: string; status: string } | null }[];
}

/** One approved day the signed-in person can clock against. */
export interface FvDay {
  id: number;
  visitDate: string;
  status: string;
  clockInTime?: string | null;
  clockInDistanceKm?: number | null;
  clockOutTime?: string | null;
  clockOutDistanceKm?: number | null;
  issue?: { id: number; key: string; title: string } | null;
  request: {
    id: number; requestNumber: string; status: string; location: string;
    latitude: number; longitude: number; geofenceRadiusM: number;
    startTime: string; endTime: string;
    project?: { id: number; name: string; key: string } | null;
  };
  tasks: { id: number; key: string; title: string }[];
}

/** One person's day on the trip, as the detail view lists it. */
export interface FvAttendance {
  id: number;
  visitDate: string;
  status: string;
  isHoliday?: boolean;
  clockInTime?: string | null;
  clockInDistanceKm?: number | null;
  clockOutTime?: string | null;
  clockOutDistanceKm?: number | null;
  issue?: { id: number; key: string; title: string } | null;
  employee: FvPerson;
}

/** A request as GET /:id returns it: the request, every day on it, and what this person may do. */
export interface FieldVisitDetail extends FieldVisitRequest {
  attendances: FvAttendance[];
  pendingChange?: any | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: FvPerson | null;
  canEdit: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canWithdraw: boolean;
  canRequestChange: boolean;
  canReviewChange: boolean;
  canCancel: boolean;
  canComplete: boolean;
}

export interface FvActivity {
  id: number;
  action: string;
  detail?: string | null;
  createdAt: string;
  actor?: FvPerson | null;
}

/** What the signed-in person may do with field visits (GET /capabilities). */
export interface FvCapabilities {
  isApprover: boolean;
  isSuperAdmin: boolean;
  allProjects: boolean;
  managedProjectIds: number[];
  isProjectManager: boolean;
}

export interface VisitLocation { id: number; name: string; address?: string | null; latitude?: number | null; longitude?: number | null }
export interface ProjectLite { id: number; name: string; key: string }
export interface TaskOption { id: number; key: string; title: string; status?: string }

export interface NewFieldVisit {
  visitType: 'PROJECT' | 'GENERAL';
  projectId?: number;
  location: string;
  visitLocationId?: number;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  remarks?: string;
  employeeIds: number[];
  tasks: { issueId?: number; name: string }[];
  submit: boolean;
}

export const fieldVisitRequestService = {
  // ── requests ──
  async list(filter: { status?: string; projectId?: number } = {}): Promise<FieldVisitRequest[]> {
    const params: Record<string, string> = {};
    if (filter.status) params.status = filter.status;
    if (filter.projectId) params.projectId = String(filter.projectId);
    const { data } = await apiClient.get('/field-visit-requests', { params });
    return data || [];
  },
  async get(id: number): Promise<FieldVisitDetail> {
    const { data } = await apiClient.get(`/field-visit-requests/${id}`);
    return data;
  },
  async timeline(id: number): Promise<FvActivity[]> {
    const { data } = await apiClient.get(`/field-visit-requests/${id}/timeline`);
    return data || [];
  },
  async capabilities(): Promise<FvCapabilities> {
    const { data } = await apiClient.get('/field-visit-requests/capabilities');
    return data;
  },
  async create(body: NewFieldVisit): Promise<FieldVisitRequest> {
    const { data } = await apiClient.post('/field-visit-requests', body);
    return data;
  },
  async withdraw(id: number) {
    await apiClient.post(`/field-visit-requests/${id}/withdraw`);
  },
  async cancel(id: number, reason: string) {
    await apiClient.post(`/field-visit-requests/${id}/cancel`, { reason });
  },

  // ── what the form picks from ──
  async projects(): Promise<ProjectLite[]> {
    const { data } = await apiClient.get('/projects');
    const rows = Array.isArray(data) ? data : data?.items || data?.data || [];
    return rows.map((p: any) => ({ id: p.id, name: p.name, key: p.key }));
  },
  async visitLocations(): Promise<VisitLocation[]> {
    const { data } = await apiClient.get('/master-data/visit-locations');
    return data || [];
  },
  async projectTasks(projectId: number): Promise<TaskOption[]> {
    const { data } = await apiClient.get(`/projects/${projectId}/issues`);
    const rows = Array.isArray(data) ? data : data?.items || [];
    return rows
      .filter((i: any) => !i.isArchived && !['DONE', 'CANCELLED'].includes(i.status))
      .map((i: any) => ({ id: i.id, key: i.key, title: i.title, status: i.status }));
  },
  /** A general visit's scope: the chosen people's own open general tasks. */
  async generalTasks(employeeIds: number[]): Promise<TaskOption[]> {
    if (!employeeIds.length) return [];
    const { data } = await apiClient.get('/field-visit-requests/general-tasks', { params: { employeeIds: employeeIds.join(',') } });
    return (data || []).map((i: any) => ({ id: i.id, key: i.key, title: i.title, status: i.status }));
  },

  // ── clocking at the site ──
  async today(): Promise<FvDay[]> {
    const { data } = await apiClient.get('/field-visit-attendance/today');
    return data || [];
  },
  async clockIn(body: { requestId: number; issueId?: number; lat: number; lng: number; accuracy?: number }) {
    const { data } = await apiClient.post('/field-visit-attendance/clock-in', body);
    return data;
  },
  async clockOut(body: { requestId: number; lat: number; lng: number; accuracy?: number }) {
    const { data } = await apiClient.post('/field-visit-attendance/clock-out', body);
    return data;
  },
};
