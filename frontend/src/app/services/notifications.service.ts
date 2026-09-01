import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';
import { HotToastService } from '@ngneat/hot-toast';
import { environment } from '../../environments/environment';

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
