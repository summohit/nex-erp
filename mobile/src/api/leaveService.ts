import { apiClient } from './apiClient';

export interface LeaveBalance {
  id: number;
  leaveTypeId: number;
  allocated: number;
  used: number;
  leaveType: {
    id: number;
    name: string;
  };
}

export interface LeaveRequest {
  id: number;
  leaveTypeId: number;
  startDate: string; // ISO date
  endDate: string; // ISO date
  reason: string;
  rejectionReason?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  leaveType: {
    id: number;
    name: string;
  };
}

export interface CreateLeaveRequestDto {
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  reason: string;
  attachmentUrl?: string;
}

export const leaveService = {
  getMyBalances: async (year?: number): Promise<LeaveBalance[]> => {
    const params = year ? { year } : {};
    const response = await apiClient.get('/leaves/balances/me', { params });
    return response.data;
  },

  getMyRequests: async (): Promise<LeaveRequest[]> => {
    const response = await apiClient.get('/leaves/requests/me');
    return response.data;
  },

  requestLeave: async (data: CreateLeaveRequestDto): Promise<LeaveRequest> => {
    const response = await apiClient.post('/leaves/request', data);
    return response.data;
  },

  cancelRequest: async (requestId: number): Promise<void> => {
    await apiClient.put(`/leaves/requests/${requestId}/cancel`);
  },

  uploadAttachment: async (fileUri: string, fileName: string, fileType: string): Promise<string> => {
    const formData = new FormData();
    formData.append('file', {
      uri: fileUri,
      name: fileName,
      type: fileType,
    } as any);

    const response = await apiClient.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data.url;
  }
};
