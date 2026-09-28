import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ApprovalDelegateRow {
  id: number;
  workflow: string;
  employeeId: number;
  employee: { id: number; firstName: string; lastName: string; avatarUrl?: string | null };
  grantedBy?: { id: number; firstName: string; lastName: string } | null;
  createdAt: string;
}

export interface ApprovalWorkflowGroup {
  workflow: string;
  label: string;
  delegates: ApprovalDelegateRow[];
}

/**
 * Who, besides the people the code already trusts, may rule on each workflow.
 *
 * Mirrors ApprovalsService on the server: the list only ever ADDS approvers,
 * and the company owner is never in it because they can approve regardless.
 */
@Injectable({ providedIn: 'root' })
export class ApprovalDelegatesService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/approvals`;

  list(): Observable<ApprovalWorkflowGroup[]> {
    return this.http.get<ApprovalWorkflowGroup[]>(`${this.apiUrl}/delegates`);
  }

  grant(workflow: string, employeeId: number) {
    return this.http.post(`${this.apiUrl}/delegates/${workflow}`, { employeeId });
  }

  revoke(workflow: string, employeeId: number) {
    return this.http.delete(`${this.apiUrl}/delegates/${workflow}/${employeeId}`);
  }
}
