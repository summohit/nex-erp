import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';

/**
 * Project tickets (§29, §30).
 *
 * A ticket is a proposed task: a project manager records a requirement — often
 * the client's — and an administrator decides whether it becomes work. Every
 * permission answer comes from the server; nothing here re-derives who may
 * approve, because a second authority is one that drifts.
 */

export type ProjectTicketStatus =
  | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CONVERTED' | 'COMPLETED' | 'CANCELLED';

export interface TicketPerson {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
}

export interface ProjectTicket {
  id: number;
  ticketNumber: string;
  title: string;
  description: string | null;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  status: ProjectTicketStatus;
  reviewedAt: string | null;
  rejectionReason: string | null;
  convertedAt: string | null;
  createdAt: string;
  raisedBy: TicketPerson | null;
  proposedAssignee: TicketPerson | null;
  reviewedBy: Pick<TicketPerson, 'id' | 'firstName' | 'lastName'> | null;
  /** The task this became. Present from CONVERTED onwards (§30). */
  convertedIssue: { id: number; key: string; title: string; status: string } | null;
  /** Only on the cross-project approval queue. */
  project?: { id: number; name: string; key: string };
}

export interface NewProjectTicket {
  title: string;
  description?: string;
  proposedAssigneeId?: number | null;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  estimatedHours?: number | null;
}

@Injectable({ providedIn: 'root' })
export class ProjectTicketsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  list(projectId: number, status?: string) {
    let params = new HttpParams();
    if (status && status !== 'ALL') {
      params = params.set('status', status);
    }
    return this.http.get<ProjectTicket[]>(`${this.api}/projects/${projectId}/tickets`, { params });
  }

  /** Everything awaiting an administrator, across projects. */
  pending() {
    return this.http.get<ProjectTicket[]>(`${this.api}/project-tickets/pending`);
  }

  create(projectId: number, data: NewProjectTicket) {
    return this.http.post<ProjectTicket>(`${this.api}/projects/${projectId}/tickets`, data);
  }

  update(ticketId: number, data: Partial<NewProjectTicket>) {
    return this.http.put<ProjectTicket>(`${this.api}/project-tickets/${ticketId}`, data);
  }

  review(ticketId: number, decision: 'APPROVED' | 'REJECTED', reason?: string) {
    return this.http.post<ProjectTicket>(`${this.api}/project-tickets/${ticketId}/review`, {
      decision, reason,
    });
  }

  cancel(ticketId: number) {
    return this.http.post<ProjectTicket>(`${this.api}/project-tickets/${ticketId}/cancel`, {});
  }
}
