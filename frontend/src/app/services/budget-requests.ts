import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

/**
 * Project budget and hours increase requests (§25).
 *
 * A budget request is nothing but budget, so the server refuses the whole list
 * to anyone who may not see a project's money — there is no partial view to
 * render and no field-stripping to mirror here.
 */

export type BudgetRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface BudgetRequest {
  id: number;
  additionalHours: number | null;
  additionalBudget: number | null;
  reason: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  status: BudgetRequestStatus;
  reviewedAt: string | null;
  rejectionReason: string | null;
  /**
   * What the project held on either side of the decision. Present only on an
   * approved request — "+500 hrs" is not a history, "2,000 → 2,500" is.
   */
  hoursBefore: number | null;
  hoursAfter: number | null;
  budgetBefore: number | null;
  budgetAfter: number | null;
  createdAt: string;
  requestedBy: { id: number; firstName: string; lastName: string; avatarUrl?: string | null } | null;
  reviewedBy: { id: number; firstName: string; lastName: string } | null;
  /** Only on the cross-project approval queue. */
  project?: {
    id: number; name: string; key: string; currency: string;
    estimatedHours: number | null; budgetAmount: number | null;
  };
}

export interface BudgetRequestList {
  currency: string;
  /** What a new request is measured against, so the form needs no second call. */
  current: { estimatedHours: number | null; budgetAmount: number | null };
  /** Reading and raising are different permissions — finance may do one only. */
  canRequest: boolean;
  canApprove: boolean;
  requests: BudgetRequest[];
}

export interface NewBudgetRequest {
  additionalHours?: number | null;
  additionalBudget?: number | null;
  reason: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
}

@Injectable({ providedIn: 'root' })
export class BudgetRequestsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  list(projectId: number) {
    return this.http.get<BudgetRequestList>(`${this.api}/projects/${projectId}/budget-requests`);
  }

  pending() {
    return this.http.get<BudgetRequest[]>(`${this.api}/budget-requests/pending`);
  }

  create(projectId: number, data: NewBudgetRequest) {
    return this.http.post<BudgetRequest>(`${this.api}/projects/${projectId}/budget-requests`, data);
  }

  review(id: number, decision: 'APPROVED' | 'REJECTED', reason?: string) {
    return this.http.post<BudgetRequest>(`${this.api}/budget-requests/${id}/review`, {
      decision, reason,
    });
  }

  cancel(id: number) {
    return this.http.post<BudgetRequest>(`${this.api}/budget-requests/${id}/cancel`, {});
  }
}
