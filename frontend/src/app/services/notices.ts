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
  createdBy: { id: number; firstName: string; lastName: string; avatarUrl: string | null } | null;
  attachments?: NoticeAttachment[];
  /** For a reader: whether they have seen it. */
  isRead?: boolean;
  /** For whoever may post: who it was addressed to (null = everybody). */
  audience?: NoticeAudience | null;
  /** For whoever may post: recipients stored, and how many have seen it. */
  _count?: { recipients: number; reads: number };
}

export interface NoticeAudience {
  departmentIds?: number[];
  roles?: string[];
  designationIds?: number[];
  /** Unticked from the department/role/designation matches. */
  excludeUserIds?: number[];
  /** Picked by name — always in. */
  userIds?: number[];
}

export interface AudiencePerson {
  userId: number;
  name: string;
  email: string;
  role: string;
  departmentId: number | null;
  designationId: number | null;
  designation: string | null;
}

export interface AudienceOptions {
  departments: { id: number; name: string }[];
  roles: string[];
  designations: { id: number; name: string }[];
  people: AudiencePerson[];
}

export interface NoticeViewer {
  userId: number;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  designation: string | null;
  department: string | null;
  viewed: boolean;
  viewedAt: string | null;
}

export interface NoticeViews {
  noticeId: number;
  title: string;
  audience: NoticeAudience | null;
  total: number;
  viewedCount: number;
  pendingCount: number;
  viewed: NoticeViewer[];
  pending: NoticeViewer[];
}

export interface NoticeAttachment {
  id: number;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
}

export interface NewNotice {
  title: string;
  body: string;
  priority?: string;
  publishedAt?: string | null;
  expiresAt?: string | null;
  /** Defaults to true server-side — posting a notice emails it. */
  sendEmail?: boolean;
  attachments?: { fileName: string; fileUrl: string; fileSize?: number | null }[];
  /** Null or empty = everybody. Fixed once posted. */
  audience?: NoticeAudience | null;
}

/**
 * A notice body as HTML. Notices from before the rich text editor are plain
 * text; shown as HTML they would lose their line breaks, so they become
 * paragraphs. Editor output is already HTML, cleaned by the server.
 */
export function noticeBodyHtml(body: string): string {
  const b = body || '';
  if (/^\s*</.test(b)) return b;
  const esc = b.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.split(/\n/).map((line) => `<p>${line || '<br>'}</p>`).join('');
}

/** A notice body as plain text, for snippets, search and copying. */
export function noticeBodyText(body: string): string {
  const b = body || '';
  if (!/^\s*</.test(b)) return b.trim();
  const doc = new DOMParser().parseFromString(b, 'text/html');
  doc.querySelectorAll('p, li, h1, h2, h3, tr, br').forEach((el) => el.append(' '));
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

@Injectable({ providedIn: 'root' })
export class NoticesService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/notices`;

  /** What the person at the dashboard should see, with their read state. */
  forDashboard() {
    return this.http.get<Notice[]>(`${this.api}/dashboard`);
  }

  /**
   * The board. Everybody may read it; whoever may post also sees retired and
   * scheduled notices, and gets canPost back so the page knows what to offer.
   */
  list() {
    return this.http.get<{ notices: Notice[]; canPost: boolean }>(this.api);
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

  /** Departments, roles and people a notice can be addressed to. */
  audienceOptions() {
    return this.http.get<AudienceOptions>(`${this.api}/audience-options`);
  }

  /** Who has and has not seen a notice. */
  views(id: number) {
    return this.http.get<NoticeViews>(`${this.api}/${id}/views`);
  }

  markRead(id: number) {
    return this.http.post<{ success: boolean }>(`${this.api}/${id}/read`, {});
  }
}
