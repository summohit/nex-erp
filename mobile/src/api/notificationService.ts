import { apiClient } from './apiClient';

export interface AppNotification {
  id: number;
  title: string;
  message: string;
  isRead: boolean;
  type: string;
  linkUrl?: string;
  createdAt: string;
}

export const notificationService = {
  getMyNotifications: async (): Promise<AppNotification[]> => {
    const response = await apiClient.get('/notifications');
    return response.data.notifications || [];
  },
  markAsRead: async (id: number): Promise<void> => {
    await apiClient.put(`/notifications/${id}/read`);
  },
  markAllAsRead: async (): Promise<void> => {
    await apiClient.put('/notifications/read-all');
  },
};
