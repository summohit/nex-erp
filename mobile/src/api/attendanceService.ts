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
  
  /**
   * `from`/`to` are ISO dates. Passing the month actually on screen keeps the
   * response to ~30 rows; omitting them makes the server fall back to a year of
   * history, which is far more than the grid ever renders.
   */
  getMyHistory: async (from?: string, to?: string): Promise<AttendanceRecord[]> => {
    const response = await apiClient.get('/attendance/history/me', {
      params: from && to ? { from, to } : undefined,
    });
    return response.data;
  },

  getMyRegularizations: async (): Promise<any[]> => {
    const response = await apiClient.get('/attendance/regularization/me');
    return response.data;
  },

  requestRegularization: async (data: { date: string; proposedClockIn?: string; proposedClockOut?: string; reason: string }): Promise<any> => {
    const response = await apiClient.post('/attendance/regularization', data);
    return response.data;
  },

  getHolidays: async (): Promise<any[]> => {
    const response = await apiClient.get('/master-data/holidays');
    return response.data;
  }
};
