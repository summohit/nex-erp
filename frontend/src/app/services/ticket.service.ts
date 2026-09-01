import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TicketEmployee {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  designation?: { name: string };
  department?: { id: number; name: string };
}

export interface TicketComment {
  id: number;
  body: string;
  authorId: number;
  author: TicketEmployee;
  createdAt: string;
  updatedAt: string;
}

export interface TicketAttachment {
  id: number;
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
  uploadedBy?: TicketEmployee;
  createdAt: string;
}

/** An attachment being composed client-side, before the ticket exists. */
export interface NewTicketAttachment {
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
}

export interface TicketActivity {
  id: number;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  actor: TicketEmployee;
  createdAt: string;
}

export interface Ticket {
  id: number;
  ticketNumber: string;
  title: string;
  description?: string;
  type: 'BUG' | 'FEATURE_REQUEST' | 'IMPROVEMENT' | 'QUESTION';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'REJECTED';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  platform: 'WEB' | 'MOBILE' | 'BOTH';
  departmentId: number | null;
  department?: { id: number; name: string };
  reporterId: number;
  reporter?: TicketEmployee;
  assigneeId?: number;
  assignee?: TicketEmployee;
  dueDate?: string;
  resolvedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  comments?: TicketComment[];
  activities?: TicketActivity[];
  attachments?: TicketAttachment[];
  _count?: { comments: number };
}

export interface TicketStats {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  byDepartment: { departmentId: number; departmentName: string; count: number }[];
}

/** Server-resolved capabilities for the current user (the JWT has no department). */
export interface TicketPermissions {
  canManage: boolean;
  isDevTeam: boolean;
  isManagement: boolean;
  employeeId: number | null;
  departmentId: number | null;
  departmentName: string | null;
}

@Injectable({ providedIn: 'root' })
export class TicketService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/tickets`;

  getTickets(filters: Record<string, any> = {}): Observable<Ticket[]> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => { if (v != null && v !== '') params = params.set(k, String(v)); });
    return this.http.get<Ticket[]>(this.apiUrl, { params });
  }

  getMyPermissions(): Observable<TicketPermissions> {
    return this.http.get<TicketPermissions>(`${this.apiUrl}/my-permissions`);
  }

  getStats(): Observable<TicketStats> {
    return this.http.get<TicketStats>(`${this.apiUrl}/stats`);
  }

  getTicket(id: number): Observable<Ticket> {
    return this.http.get<Ticket>(`${this.apiUrl}/${id}`);
  }

  createTicket(data: Omit<Partial<Ticket>, 'attachments'> & { attachments?: NewTicketAttachment[] }): Observable<Ticket> {
    return this.http.post<Ticket>(this.apiUrl, data);
  }

  /** Employees in the ticket's department — the only valid reassignment targets. */
  getAssignableMembers(ticketId: number): Observable<TicketEmployee[]> {
    return this.http.get<TicketEmployee[]>(`${this.apiUrl}/${ticketId}/assignable-members`);
  }

  /** Uploads one image to ImageKit via the backend and returns its hosted URL. */
  uploadImage(file: File): Observable<{ url: string }> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ url: string }>(`${environment.apiUrl}/upload/ticket-attachment`, form);
  }

  updateTicket(id: number, data: Partial<Ticket>): Observable<Ticket> {
    return this.http.patch<Ticket>(`${this.apiUrl}/${id}`, data);
  }

  deleteTicket(id: number): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/${id}`);
  }

  addComment(ticketId: number, body: string): Observable<TicketComment> {
    return this.http.post<TicketComment>(`${this.apiUrl}/${ticketId}/comments`, { body });
  }

  updateComment(ticketId: number, commentId: number, body: string): Observable<TicketComment> {
    return this.http.patch<TicketComment>(`${this.apiUrl}/${ticketId}/comments/${commentId}`, { body });
  }

  deleteComment(ticketId: number, commentId: number): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/${ticketId}/comments/${commentId}`);
  }
}
