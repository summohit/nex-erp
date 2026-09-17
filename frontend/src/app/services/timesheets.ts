import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';

/**
 * The Timesheet (§20–§22).
 *
 * Login − Logged = Unlogged. Every number on the screen comes from the server
 * already reconciled; nothing here recomputes hours, because the grid and the
 * approval rule have to agree on what a day was worth and there is only one
 * place that can be true.
 */

export type TimesheetStatus = 'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/** The §21 views, as one screen with a scope switch. */
export type TimesheetScope = 'ME' | 'TEAM' | 'ALL' | 'FINANCE';

export interface TimesheetEntry {
  id: number;
  issueId: number;
  issueKey: string;
  issueTitle: string;
  projectId: number | null;
  projectName: string | null;
  projectCode: string | null;
  clientName: string | null;
  taskType: string | null;
  startedAt: string;
  endedAt: string | null;
  hours: number;
  source: 'TIMER' | 'MANUAL';
  /** What the person was doing (§19). Null on rows written before the field. */
  note: string | null;
}

export interface TimesheetDay {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  /** The clock-out was the 23:00 sweep's cutoff, not an observation. */
  autoClockedOut: boolean;
  sessionOpen: boolean;
  loginHours: number;
  loggedHours: number;
  manualHours: number;
  timerHours: number;
  unloggedHours: number;
  overLogged: boolean;
  /** The longest single entry on the day, in hours. */
  longestEntryHours: number;
  /** That entry is too long to be a real sitting — an unstopped timer. */
  hasImplausibleEntry: boolean;
  /** Time booked on a day with no clock-in at all. */
  loggedWithoutLogin: boolean;
  status: TimesheetStatus;
  submittedHours: number | null;
  /** Logs stay editable after submission; this is how that shows up. */
  changedSinceSubmission: boolean;
  rejectionReason: string | null;
  reviewedBy: { id: number; firstName: string; lastName: string } | null;
  reviewedAt: string | null;
  entries?: TimesheetEntry[];
}

export interface TimesheetWeek {
  employee: { id: number; firstName: string; lastName: string; avatarUrl?: string | null };
  days: TimesheetDay[];
  totals: { loginHours: number; loggedHours: number; unloggedHours: number };
}

export interface OverviewRow {
  employee: {
    id: number;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    employeeCode: string | null;
    department: { id: number; name: string } | null;
    /**
     * The user account is suspended. Listed anyway — the hours are history.
     * Deliberately not "any non-active account": an unverified login is a
     * provisioning fact about current staff, not a timesheet fact.
     */
    isInactive: boolean;
  };
  days: Pick<
    TimesheetDay,
    'date' | 'loginHours' | 'loggedHours' | 'unloggedHours' | 'manualHours'
    | 'timerHours' | 'status' | 'sessionOpen' | 'overLogged' | 'changedSinceSubmission'
    | 'hasImplausibleEntry' | 'loggedWithoutLogin'
  >[];
  totals: {
    loginHours: number; loggedHours: number; unloggedHours: number;
    manualHours: number; timerHours: number;
  };
  counts: { pending: number; approved: number; rejected: number; needsAttention: number };
  /** Finance only. `amount` is null when nobody has set the person a rate. */
  cost?: { hourlyRate: number | null; amount: number | null; unratedHours: number };
}

export interface TimesheetOverview {
  scope: TimesheetScope;
  canViewCost: boolean;
  /**
   * A project/client/PM/source filter is on, so "logged" no longer means the
   * whole day and unlogged hours are not the gap they claim to be. The screen
   * hides that column rather than print a number that has stopped being true.
   */
  hoursFiltered: boolean;
  employees: OverviewRow[];
  totals: {
    loginHours: number; loggedHours: number; unloggedHours: number;
    manualHours: number; timerHours: number; cost: number; unratedHours: number;
  };
}

export interface TimesheetFilters {
  employeeId?: number | null;
  projectId?: number | null;
  clientId?: number | null;
  departmentId?: number | null;
  pmId?: number | null;
  source?: 'MANUAL' | 'TIMER' | null;
  status?: TimesheetStatus | null;
  /** Free text over task key and title. */
  task?: string | null;
  billable?: 'BILLABLE' | 'NON_BILLABLE' | null;
}

@Injectable({ providedIn: 'root' })
export class TimesheetsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/timesheets`;

  /** The caller's own week (§21, "My Timesheet"). */
  getMyWeek(startDate: string, endDate: string) {
    return this.http.get<TimesheetWeek>(`${this.apiUrl}/me`, {
      params: { startDate, endDate },
    });
  }

  /** Somebody else's week, opened from a team row. */
  getEmployeeWeek(employeeId: number, startDate: string, endDate: string) {
    return this.http.get<TimesheetWeek>(`${this.apiUrl}/employee/${employeeId}`, {
      params: { startDate, endDate },
    });
  }

  /** The team, all-employees and cost views (§21). */
  getOverview(
    scope: TimesheetScope,
    startDate: string,
    endDate: string,
    filters: TimesheetFilters = {},
  ) {
    let params = new HttpParams()
      .set('scope', scope)
      .set('startDate', startDate)
      .set('endDate', endDate);

    for (const [key, value] of Object.entries(filters)) {
      if (value != null && value !== '' && value !== 'ALL') {
        params = params.set(key, String(value));
      }
    }

    return this.http.get<TimesheetOverview>(`${this.apiUrl}/overview`, { params });
  }

  /** Days waiting on this reviewer. */
  getPendingReviews() {
    return this.http.get<any[]>(`${this.apiUrl}/pending`);
  }

  submitDay(date: string) {
    return this.http.post(`${this.apiUrl}/submit`, { date });
  }

  reviewDay(employeeId: number, date: string, decision: 'APPROVED' | 'REJECTED', reason?: string) {
    return this.http.post(`${this.apiUrl}/review`, { employeeId, date, decision, reason });
  }
}
