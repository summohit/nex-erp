import { apiClient } from './apiClient';

/** Work From Home requests (19 Oct 2026): manager then HR, monthly limit. */
export interface WfhRequest {
  id: number; employeeId: number; date: string; reason: string;
  status: 'PENDING_MANAGER' | 'PENDING_HR' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reviewNote?: string | null;
  employee?: any;
}

export const wfhService = {
  async mine(): Promise<{ limit: number; usedThisMonth: number; requests: WfhRequest[] }> {
    const { data } = await apiClient.get('/wfh/mine');
    return data;
  },
  async create(date: string, reason: string): Promise<WfhRequest> {
    const { data } = await apiClient.post('/wfh', { date, reason });
    return data;
  },
  async cancel(id: number) {
    const { data } = await apiClient.post(`/wfh/${id}/cancel`, {});
    return data;
  },
  async canApprove(): Promise<boolean> {
    const { data } = await apiClient.get('/wfh/can-approve');
    return !!data?.canApprove;
  },
  async pending(): Promise<WfhRequest[]> {
    const { data } = await apiClient.get('/wfh/pending');
    return data;
  },
  async decide(id: number, action: 'APPROVE' | 'REJECT', note?: string) {
    const { data } = await apiClient.post(`/wfh/${id}/review`, { action, note });
    return data;
  },
};
