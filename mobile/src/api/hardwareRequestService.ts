import { apiClient } from './apiClient';

export interface HardwareRequest {
  id: number;
  requestType: string;
  category: string;
  urgency: string;
  reason: string;
  status: string;
  images?: string[];
  rejectionReason?: string;
  createdAt: string;
  employee?: { firstName: string; lastName: string };
}

export const hardwareRequestService = {
  getAll: async (): Promise<HardwareRequest[]> => {
    const response = await apiClient.get('/assets/requests');
    return response.data;
  },

  create: async (data: {
    requestType: string;
    category: string;
    urgency: string;
    reason: string;
    images?: string[];
  }): Promise<HardwareRequest> => {
    const response = await apiClient.post('/assets/requests', data);
    return response.data;
  },

  update: async (
    id: number,
    data: {
      requestType?: string;
      category?: string;
      urgency?: string;
      reason?: string;
      images?: string[];
    }
  ): Promise<HardwareRequest> => {
    const response = await apiClient.put(`/assets/requests/${id}`, data);
    return response.data;
  },

  cancel: async (id: number): Promise<void> => {
    await apiClient.delete(`/assets/requests/${id}`);
  },
};
