import { apiClient } from './apiClient';

export interface AppNotification {
  id: number;
  title: string;
  message: string;
  isRead: boolean;
  type: string;
  createdAt: string;
}

export const notificationService = {
  getMyNotifications: async (): Promise<AppNotification[]> => {
    const response = await apiClient.get('/notifications');
    return response.data.notifications || [];
  }
};
