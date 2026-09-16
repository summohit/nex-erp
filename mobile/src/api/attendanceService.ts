import { apiClient } from './apiClient';

/**
 * The two refusals the server sends that are instructions rather than errors.
 *
 * Both arrive as a 400 whose body carries a stable `code` — matching on the
 * message text would break the first time somebody rewords it. See
 * OpenSessionError / LateClockOutError on the server.
 */
export const CLOCK_ERROR = {
  /** A previous day is still open; nothing new may start until it is closed. */
  OPEN_PREVIOUS_SESSION: 'OPEN_PREVIOUS_SESSION',
  /** Closing a previous day after midnight — say why. */
  LATE_REASON_REQUIRED: 'LATE_CLOCK_OUT_REASON_REQUIRED',
} as const;

export interface ClockRefusal {
  code?: string;
  /** The day whose session is still open, as YYYY-MM-DD. */
  openSessionDate?: string;
  message?: string;
}

/**
 * Pull the server's own explanation out of an axios error.
 *
 * `error.message` is axios's ("Request failed with status code 400"), which
 * tells the user nothing. The body is where the real sentence lives.
 */
export function clockRefusal(error: any): ClockRefusal {
  const body = error?.response?.data ?? {};
  return {
    code: body.code,
    openSessionDate: body.openSessionDate,
    message: Array.isArray(body.message) ? body.message[0] : body.message,
  };
}

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
  
  /**
   * `reason` is required — and only accepted — when the session being closed
   * belongs to a previous IST day. The server decides and refuses with
   * LATE_CLOCK_OUT_REASON_REQUIRED; the app asks, then retries with the answer.
   */
  clockOut: async (lat?: number, lng?: number, reason?: string): Promise<AttendanceRecord> => {
    const response = await apiClient.post('/attendance/clock-out', { lat, lng, reason });
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
