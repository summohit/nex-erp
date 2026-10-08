import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface FieldVisitPerson {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  department?: { id: number; name: string } | null;
  designation?: { id: number; name: string } | null;
  user?: { email?: string | null } | null;
}

export interface FieldVisitRequestTask {
  id: number;
  name: string;
  description?: string | null;
  position: number;
  /** The project task this line adopts, rather than describing new work. */
  issueId?: number | null;
  issue?: {
    id: number;
    key: string;
    title: string;
    status: string;
    priority: string;
    approvalState?: string | null;
    assignee?: { id: number; firstName: string; lastName: string } | null;
  } | null;
}

export interface FieldVisitRequestAttachment {
  id: number;
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
  createdAt: string;
}

/** One person's day on the trip, as the §11 register shows it. */
export interface FieldVisitRequestDay {
  id: number;
  visitDate: string;
  isHoliday: boolean;
  status: string;
  clockInTime?: string | null;
  clockInDistanceKm?: number | null;
  clockInLat?: number | null;
  clockInLng?: number | null;
  clockOutTime?: string | null;
  clockOutDistanceKm?: number | null;
  clockOutLat?: number | null;
  clockOutLng?: number | null;
  /** The task the day was clocked against (§5). */
  issue?: { id: number; key: string; title: string } | null;
  employee: FieldVisitPerson;
}

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
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED';
  rejectionReason?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  /** `isSystem` marks a general visit, filed under the hidden General project. */
  project: { id: number; name: string; key?: string | null; color?: string | null; isSystem?: boolean };
  raisedBy: FieldVisitPerson;
  reviewedBy?: { id: number; firstName: string; lastName: string } | null;
  members: { id: number; employee: FieldVisitPerson }[];
  tasks: FieldVisitRequestTask[];
  attachments: FieldVisitRequestAttachment[];
  /**
   * A change waiting for approval (§10). The trip still runs on the fields
   * above — this is only what somebody has asked it to become.
   */
  pendingChange?: PendingFieldVisitChange | null;
  pendingChangeAt?: string | null;
  /** Detail only. */
  attendances?: FieldVisitRequestDay[];
  canEdit?: boolean;
  canSubmit?: boolean;
  canReview?: boolean;
  canWithdraw?: boolean;
  canRequestChange?: boolean;
  canReviewChange?: boolean;
}

export interface PendingFieldVisitChange {
  location: string;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  visitDays: number;
  startTime: string;
  endTime: string;
  remarks?: string | null;
  employeeIds: number[];
  tasks: { name?: string; description?: string | null; issueId?: number | null }[];
}

export interface FieldVisitActivity {
  id: number;
  action: string;
  detail?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  createdAt: string;
  actor: FieldVisitPerson;
}

export interface FieldVisitRequestInput {
  /** GENERAL visits belong to no project; their scope is the people's general tasks. */
  visitType?: 'PROJECT' | 'GENERAL';
  projectId?: number;
  location: string;
  /** The saved site this was picked from, when it was (§PB10). */
  visitLocationId?: number;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  visitDays?: number;
  startTime: string;
  endTime: string;
  remarks?: string;
  employeeIds: number[];
  /** `issueId` adopts a task already on the project board; without it the line
   *  describes new work and approval mints a card per person. */
  tasks: { name?: string; description?: string; issueId?: number }[];
  attachments?: { fileName: string; fileUrl: string; fileSize?: number }[];
  submit?: boolean;
}

@Injectable({ providedIn: 'root' })
export class FieldVisitRequestsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/field-visit-requests`;

  list(filter: { status?: string; projectId?: number } = {}) {
    let params = new HttpParams();
    if (filter.status) params = params.set('status', filter.status);
    if (filter.projectId) params = params.set('projectId', String(filter.projectId));
    return this.http.get<FieldVisitRequest[]>(this.apiUrl, { params });
  }

  getOne(id: number) {
    return this.http.get<FieldVisitRequest>(`${this.apiUrl}/${id}`);
  }

  /** The §11 audit trail: who created, approved, rejected or cancelled it. */
  timeline(id: number) {
    return this.http.get<FieldVisitActivity[]>(`${this.apiUrl}/${id}/timeline`);
  }

  create(body: FieldVisitRequestInput) {
    return this.http.post<FieldVisitRequest>(this.apiUrl, body);
  }

  update(id: number, body: FieldVisitRequestInput) {
    return this.http.patch<FieldVisitRequest>(`${this.apiUrl}/${id}`, body);
  }

  submit(id: number) {
    return this.http.post<FieldVisitRequest>(`${this.apiUrl}/${id}/submit`, {});
  }

  /** overrideDayOff: roster the people on site over their rostered days off. */
  approve(id: number, opts: { overrideDayOff?: boolean; edits?: Record<string, any>; editReason?: string } = {}) {
    return this.http.post<FieldVisitRequest>(`${this.apiUrl}/${id}/approve`, opts);
  }

  reject(id: number, reason: string) {
    return this.http.post<FieldVisitRequest>(`${this.apiUrl}/${id}/reject`, { reason });
  }

  /** §10: pull a submitted request back to a draft. */
  withdraw(id: number) {
    return this.http.post<FieldVisitRequest>(`${this.apiUrl}/${id}/withdraw`, {});
  }

  /**
   * §10: propose a change to an approved trip.
   *
   * The whole request goes, not a patch — the approver rules on what the trip
   * would become.
   */
  /** Open (To Do / In Progress) general tasks assigned to any of these people. */
  getGeneralTasks(employeeIds: number[]) {
    return this.http.get<any[]>(`${this.apiUrl}/general-tasks`, {
      params: { employeeIds: employeeIds.join(',') },
    });
  }

  requestModification(id: number, body: FieldVisitRequestInput) {
    return this.http.post<FieldVisitRequest>(`${this.apiUrl}/${id}/request-modification`, body);
  }

  approveModification(id: number) {
    return this.http.post<FieldVisitRequest>(`${this.apiUrl}/${id}/modification/approve`, {});
  }

  rejectModification(id: number, reason: string) {
    return this.http.post<FieldVisitRequest>(`${this.apiUrl}/${id}/modification/reject`, { reason });
  }

  cancel(id: number, reason?: string) {
    return this.http.post<FieldVisitRequest>(`${this.apiUrl}/${id}/cancel`, { reason });
  }

  complete(id: number) {
    return this.http.post<FieldVisitRequest>(`${this.apiUrl}/${id}/complete`, {});
  }

  changeStatus(id: number, status: string, reason?: string, opts: { overrideDayOff?: boolean } = {}) {
    return this.http.post<FieldVisitRequest>(`${this.apiUrl}/${id}/status`, { status, reason, ...opts });
  }

  bulkChangeStatus(ids: number[], status: string, reason?: string, opts: { overrideDayOff?: boolean } = {}) {
    return this.http.post<Array<{ id: number; success: boolean; error?: string; code?: string }>>(
      `${this.apiUrl}/bulk/status`, { ids, status, reason, ...opts },
    );
  }
}
