import { apiClient } from './apiClient';

/**
 * The weekly timesheet as the web runs it (§21): hours booked to tasks set
 * against hours clocked in, submitted a day at a time for review.
 */

export type TsStatus = 'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface TsEntry {
  id: number;
  issueId: number;
  issueKey: string;
  issueTitle: string;
  projectName: string | null;
  projectCode: string | null;
  startedAt: string;
  endedAt: string | null;
  hours: number;
  source: 'MANUAL' | 'TIMER';
  note: string | null;
}

export interface TsDay {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  autoClockedOut: boolean;
  sessionOpen: boolean;
  loginHours: number;
  loggedHours: number;
  unloggedHours: number;
  overLogged: boolean;
  hasImplausibleEntry: boolean;
  loggedWithoutLogin: boolean;
  status: TsStatus;
  submittedHours: number | null;
  changedSinceSubmission: boolean;
  rejectionReason: string | null;
  entries: TsEntry[];
}

export interface TsWeek {
  employee: { id: number; firstName: string; lastName?: string | null };
  days: TsDay[];
  totals: { loginHours: number; loggedHours: number; unloggedHours: number };
}

export interface TsPending {
  id: number;
  date: string;
  submittedHours: number | null;
  submittedAt: string;
  employee: { id: number; firstName: string; lastName?: string | null; avatarUrl?: string | null };
}

export const timesheetService = {
  async myWeek(startDate: string, endDate: string): Promise<TsWeek> {
    const { data } = await apiClient.get('/timesheets/me', { params: { startDate, endDate } });
    return data;
  },
  async submitDay(date: string) {
    const { data } = await apiClient.post('/timesheets/submit', { date });
    return data;
  },
  /** Days waiting on the signed-in reviewer (admins: everyone's). */
  async pending(): Promise<TsPending[]> {
    const { data } = await apiClient.get('/timesheets/pending');
    return data || [];
  },
  async review(employeeId: number, date: string, decision: 'APPROVED' | 'REJECTED', reason?: string) {
    const { data } = await apiClient.post('/timesheets/review', { employeeId, date, decision, reason });
    return data;
  },
};
