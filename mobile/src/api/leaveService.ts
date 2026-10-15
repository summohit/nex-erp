import { apiClient, UPLOAD_TIMEOUT_MS } from './apiClient';

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

export interface CompOffCredit {
  id: number;
  date: string | null;
  days: number;
  reason: string;
  creditedOn: string;
  clockIn: string | null;
  clockOut: string | null;
  onsite: boolean;
  project: string | null;
  fieldVisit: { id: number; number: string; location: string; project: string | null } | null;
}

export interface CompOffPerson {
  allocated: number;
  used: number;
  remaining: number;
  earnedFromWork: number;
  addedManually: number;
  credits: CompOffCredit[];
  used_leaves: { id: number; from: string; to: string; halfDay: boolean; reason?: string | null }[];
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

  /** Every leave type, so the quota lists types with no balance as 0 (as the web does). */
  getLeaveTypes: async (): Promise<{ id: number; name: string; isPaid?: boolean }[]> => {
    const response = await apiClient.get('/master-data/leave-types');
    return response.data || [];
  },

  /** Own comp-off history for a year: what each day was earned for and where it was used. */
  getMyCompOffHistory: async (year: number): Promise<CompOffPerson | null> => {
    const response = await apiClient.get('/attendance/comp-off/history', { params: { year, mine: 1 } });
    return response.data?.employees?.[0] ?? null;
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
      timeout: UPLOAD_TIMEOUT_MS,
    });

    return response.data.url;
  }
};
