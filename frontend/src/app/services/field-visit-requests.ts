import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface FieldVisitPerson {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
}

export interface FieldVisitRequestTask {
  id: number;
  name: string;
  description?: string | null;
  position: number;
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
  clockOutTime?: string | null;
  clockOutDistanceKm?: number | null;
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
  project: { id: number; name: string; key?: string | null; color?: string | null };
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
  tasks: { name: string; description?: string | null }[];
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
  projectId: number;
  location: string;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  visitDays?: number;
  startTime: string;
  endTime: string;
  remarks?: string;
  employeeIds: number[];
  tasks: { name: string; description?: string }[];
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

  approve(id: number) {
    return this.http.post<FieldVisitRequest>(`${this.apiUrl}/${id}/approve`, {});
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
}
