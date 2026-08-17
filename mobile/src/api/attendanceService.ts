import { apiClient } from './apiClient';

export interface AttendanceRecord {
  id: number;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  totalHours: number;
  status: string;
}

export const attendanceService = {
  getTodayAttendance: async (): Promise<AttendanceRecord | null> => {
    const response = await apiClient.get('/attendance/me');
    return response.data;
  },
  
  clockIn: async (lat?: number, lng?: number): Promise<AttendanceRecord> => {
    const response = await apiClient.post('/attendance/clock-in', { lat, lng });
    return response.data;
  },
  
  clockOut: async (lat?: number, lng?: number): Promise<AttendanceRecord> => {
    const response = await apiClient.post('/attendance/clock-out', { lat, lng });
    return response.data;
  },
  
  getMyHistory: async (): Promise<AttendanceRecord[]> => {
    const response = await apiClient.get('/attendance/history/me');
    return response.data;
  }
};
