import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

/**
 * The company notice board.
 *
 * Distinct from notifications: a notification is about something that happened
 * to you, a notice is the company talking to everybody at once and stays in
 * front of each person until they have seen it.
 */
export interface Notice {
  id: number;
  title: string;
  body: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  publishedAt: string;
  expiresAt: string | null;
  isActive: boolean;
  emailSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: number; firstName: string; lastName: string } | null;
  /** Only on the dashboard feed: whether this reader has dismissed it. */
  isRead?: boolean;
}

export interface NewNotice {
  title: string;
  body: string;
  priority?: string;
  publishedAt?: string | null;
  expiresAt?: string | null;
  /** Defaults to true server-side — posting a notice emails it. */
  sendEmail?: boolean;
}

@Injectable({ providedIn: 'root' })
export class NoticesService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/notices`;

  /** What the person at the dashboard should see, with their read state. */
  forDashboard() {
    return this.http.get<Notice[]>(`${this.api}/dashboard`);
  }

  /** Every notice, for the admin screen. */
  list() {
    return this.http.get<Notice[]>(this.api);
  }

  create(data: NewNotice) {
    return this.http.post<Notice>(this.api, data);
  }

  update(id: number, data: Partial<NewNotice> & { isActive?: boolean }) {
    return this.http.put<Notice>(`${this.api}/${id}`, data);
  }

  /** Retires it. The record of what was announced is kept. */
  retire(id: number) {
    return this.http.delete<Notice>(`${this.api}/${id}`);
  }

  markRead(id: number) {
    return this.http.post<{ success: boolean }>(`${this.api}/${id}/read`, {});
  }
}
