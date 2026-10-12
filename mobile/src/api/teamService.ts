import { apiClient } from './apiClient';

/** A leave request from someone who reports to the signed-in person. */
export interface TeamLeaveRequest {
  id: number;
  startDate: string;
  endDate: string;
  isHalfDay?: boolean;
  halfDayPeriod?: string | null;
  reason?: string | null;
  rejectionReason?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  leaveType: { id: number; name: string };
  employee: {
    id: number;
    firstName: string;
    lastName?: string | null;
    avatarUrl?: string | null;
    employeeCode?: string | null;
    designation?: { name: string } | null;
    department?: { name: string } | null;
  };
}

/** One day of the signed-in person's schedule (today + the next 13 days). */
export interface ShiftDay {
  date: string;
  weekday: string;
  isDayOff: boolean;
  shiftName: string;
  shortCode?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  note?: string;
  projectName?: string | null;
}

export interface Notice {
  id: number;
  title: string;
  body: string;
  priority?: string | null;
  publishedAt?: string | null;
  expiresAt?: string | null;
  isRead?: boolean;
  createdBy?: { firstName: string; lastName?: string | null; avatarUrl?: string | null } | null;
  attachments?: { id: number; fileName: string; fileUrl: string }[];
}

export const teamService = {
  /** Leave from everyone below the signed-in person in the reporting line. */
  async getTeamLeaveRequests(): Promise<TeamLeaveRequest[]> {
    const { data } = await apiClient.get('/leaves/requests/managers');
    return data || [];
  },

  /** Approve or reject. The server checks the reporting line again. */
  async decideLeave(id: number, status: 'APPROVED' | 'REJECTED', rejectionReason?: string) {
    const { data } = await apiClient.put(`/leaves/requests/${id}/status`, { status, rejectionReason });
    return data;
  },

  /** The 14-day schedule the web dashboard shows, roster first. */
  async getMySchedule(): Promise<ShiftDay[]> {
    const { data } = await apiClient.get('/dashboard');
    return data?.myShiftSchedule || [];
  },

  async getNotices(): Promise<Notice[]> {
    const { data } = await apiClient.get('/notices');
    return data || [];
  },

  async markNoticeRead(id: number) {
    await apiClient.post(`/notices/${id}/read`);
  },
};
