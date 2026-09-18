import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

/**
 * Additional-hours requests on a task (§3), and the tracking view over all of
 * them (§4).
 *
 * The task-level counterpart to BudgetRequestsService. Unlike a budget
 * request, these carry no money, so they are not gated on financial
 * visibility — an employee can always see what they asked for.
 */

export type TaskHoursRequestStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED';

export interface TaskHoursRequest {
  id: number;
  requestedHours: number;
  /** What was actually granted. May be less than requested. */
  approvedHours: number | null;
  reason: string;
  status: TaskHoursRequestStatus;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  requestedBy: { id: number; firstName: string; lastName: string } | null;
  reviewedBy: { id: number; firstName: string; lastName: string } | null;
  issue: {
    id: number; key: string; title: string;
    estimatedHours: number | null; additionalHours: number; assigneeId: number | null;
    project: { id: number; name: string; key: string; leadId: number | null };
  };
}

/** Where a task's hours stand right now. `null` means never estimated. */
export interface TaskHoursSummary {
  assigned: number | null;
  additional: number;
  allowed: number | null;
  logged: number;
  remaining: number | null;
}

export interface TaskHoursRequestList {
  requests: TaskHoursRequest[];
  hours: TaskHoursSummary;
  canRequest: boolean;
  canApprove: boolean;
}

export interface TaskHoursActivity {
  id: number;
  /** CREATED, SUBMITTED, APPROVED, REJECTED, HOURS_MODIFIED, UPDATED */
  action: string;
  detail: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  actor: { id: number; firstName: string; lastName: string } | null;
}

@Injectable({ providedIn: 'root' })
export class TaskHoursRequestsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** One task's requests, plus where its hours currently stand. */
  forIssue(issueId: number) {
    return this.http.get<TaskHoursRequestList>(`${this.api}/issues/${issueId}/hours-requests`);
  }

  create(issueId: number, data: { requestedHours: number; reason: string }) {
    return this.http.post<TaskHoursRequest>(`${this.api}/issues/${issueId}/hours-requests`, data);
  }

  review(
    id: number,
    decision: 'APPROVED' | 'REJECTED',
    data: { approvedHours?: number | null; reason?: string } = {},
  ) {
    return this.http.patch<TaskHoursRequest>(
      `${this.api}/task-hours-requests/${id}/review`, { decision, ...data },
    );
  }

  /** §4: every request this person is entitled to see. */
  listAll(filters: { status?: string; projectId?: string } = {}) {
    const params: any = {};
    if (filters.status && filters.status !== 'ALL') params.status = filters.status;
    if (filters.projectId && filters.projectId !== 'ALL') params.projectId = filters.projectId;
    return this.http.get<TaskHoursRequest[]>(`${this.api}/task-hours-requests`, { params });
  }

  /** §4: one request's full history, oldest first. */
  timeline(id: number) {
    return this.http.get<TaskHoursActivity[]>(`${this.api}/task-hours-requests/${id}/timeline`);
  }
}
