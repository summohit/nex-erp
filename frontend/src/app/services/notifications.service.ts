import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';
import { HotToastService } from '@ngneat/hot-toast';
import { environment } from '../../environments/environment';

export interface NotificationPage {
  notifications: NotificationItem[];
  unreadCount: number;
  total: number;
  skip: number;
  take: number;
}

export interface NotificationPrefs {
  /** False when the preferences table hasn't been created yet. */
  available?: boolean;
  /** Types this user has switched off. Anything absent is on. */
  muted: string[];
  /** Types the server refuses to mute, so the UI can show them locked. */
  unmutable: string[];
}

export interface NotificationTypeCount {
  type: string;
  count: number;
}

export interface NotificationItem {
  id: number;
  userId: number;
  title: string;
  message: string;
  type: string;
  linkUrl?: string;
  isRead: boolean;
  createdAt: string;
}

@Injectable({
  providedIn: 'root',
})
export class NotificationsService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private toast = inject(HotToastService);

  private socket: Socket | null = null;
  private baseUrl = 'https://nex.ces-pl.com'; // Fallback to production URL or window origin

  notifications = signal<NotificationItem[]>([]);
  unreadCount = signal<number>(0);

  constructor() {
    this.initSocket();
    this.loadNotifications();
  }

  private loadNotifications() {
    const token = this.authService.getToken();
    if (!token) return;

    this.http.get<{ notifications: NotificationItem[]; unreadCount: number }>(`${environment.apiUrl}/notifications`)
      .subscribe({
        next: (res) => {
          this.notifications.set(res.notifications || []);
          this.unreadCount.set(res.unreadCount || 0);
        },
        error: (err) => console.error('Failed to load notifications:', err)
      });
  }

  private initSocket() {
    const token = this.authService.getToken();
    if (!token) return;

    const wsUrl = window.location.hostname === 'localhost' 
      ? `${environment.apiUrl}/ws/notifications`
      : `${window.location.origin}/ws/notifications`;

    this.socket = io(wsUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
    });

    this.socket.on('connect', () => {
      console.log('⚡ Connected to NEX ERP Real-Time Notification Socket');
    });

    this.socket.on('notification', (newNotif: NotificationItem) => {
      this.notifications.update(list => [newNotif, ...list]);
      this.unreadCount.update(c => c + 1);

      // Show real-time toast banner
      this.toast.info(`🔔 ${newNotif.title}: ${newNotif.message}`, {
        duration: 5000,
        position: 'top-right',
        style: {
          border: '1px solid #FF5200',
          padding: '12px',
          color: '#0F172A',
          background: '#FFFFFF',
        },
      });
    });
  }

  /**
   * Paged/filtered fetch for the history page. Kept separate from the signal
   * the bell reads, so browsing history never rewrites the bell's list.
   */
  fetchPage(opts: { type?: string; unreadOnly?: boolean; skip?: number; take?: number } = {}) {
    let params: any = {};
    if (opts.type) params.type = opts.type;
    if (opts.unreadOnly) params.unreadOnly = 'true';
    if (opts.skip) params.skip = String(opts.skip);
    if (opts.take) params.take = String(opts.take);
    return this.http.get<NotificationPage>(`${environment.apiUrl}/notifications`, { params });
  }

  getPreferences() {
    return this.http.get<NotificationPrefs>(`${environment.apiUrl}/notifications/preferences`);
  }

  setPreference(type: string, muted: boolean) {
    return this.http.put<NotificationPrefs>(`${environment.apiUrl}/notifications/preferences`, { type, muted });
  }

  getTypes() {
    return this.http.get<NotificationTypeCount[]>(`${environment.apiUrl}/notifications/types`);
  }

  markAsRead(id: number) {
    this.http.put<{ notifications: NotificationItem[]; unreadCount: number }>(`/api/notifications/${id}/read`, {})
      .subscribe({
        next: (res) => {
          this.notifications.set(res.notifications || []);
          this.unreadCount.set(res.unreadCount || 0);
        }
      });
  }

  markAllAsRead() {
    this.http.put<{ notifications: NotificationItem[]; unreadCount: number }>('/api/notifications/read-all', {})
      .subscribe({
        next: (res) => {
          this.notifications.set(res.notifications || []);
          this.unreadCount.set(res.unreadCount || 0);
        }
      });
  }
}
